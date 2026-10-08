#!/usr/bin/env bun
// Offline ears test, no mic and no Claude: real speech fixtures (16 kHz s16le)
// padded with room-level noise, run through the VAD, whisper-server and the
// wake word, exactly as the live path does.
//
// The fixtures are NOT shipped (they would be someone's real voice). Record
// your own into tests/fixtures/ (raw 16 kHz mono s16le, e.g.
// `pw-record --rate 16000 --channels 1 --format s16 --raw - > x.pcm`):
//   wake.pcm      you saying "<wake word>, what time is it?"
//   no-wake.pcm   you saying a sentence WITHOUT the wake word, containing "evening"
// Missing fixtures, whisper-server or a model: the script says SKIP and exits 0.
//   bun scripts/ears-test.ts
import { EnergyVad, FRAME_MS, FRAME_SAMPLES, isNoiseTranscript, pcmToWav } from '../src/ears'
import { checkWakeWord } from '../src/wake'
import { loadSwitch } from '../src/config'
import { findWhisperModel, which } from '../src/platform'
import { WhisperServer } from '../src/whisper'
import { join } from 'path'

const FIX = join(import.meta.dir, '../tests/fixtures')
const wakeWord = loadSwitch().wakeWord
const cases = [
  { file: 'wake.pcm', wake: true, expect: /time/i },
  { file: 'no-wake.pcm', wake: false, expect: /evening/i },
]

const present: typeof cases = []
for (const c of cases) if (await Bun.file(join(FIX, c.file)).exists()) present.push(c)
if (!present.length) { console.log(`SKIP: no audio fixtures in ${FIX} (see the header of this script)`); process.exit(0) }
if (!which('whisper-server') || !findWhisperModel()) { console.log('SKIP: whisper-server or a whisper model is missing (bun scripts/setup.ts)'); process.exit(0) }

// About -50 dBFS of noise, a quiet room.
function noise(ms: number): Int16Array {
  const n = new Int16Array((16000 * ms) / 1000)
  for (let i = 0; i < n.length; i++) n[i] = Math.round((Math.random() * 2 - 1) * 180)
  return n
}

const ws = new WhisperServer(undefined, undefined, 6, m => console.log('  [whisper]', m))
await ws.start()
let failed = 0
try {
  for (const c of present) {
    const buf = await Bun.file(join(FIX, c.file)).arrayBuffer()
    const speech = new Int16Array(buf.slice(0, buf.byteLength & ~1))
    const stream = new Int16Array(16000 + speech.length + 24000)
    stream.set(noise(1000)); stream.set(speech, 16000); stream.set(noise(1500), 16000 + speech.length)

    const vad = new EnergyVad()
    const utts = []
    for (let i = 0, now = 0; i + FRAME_SAMPLES <= stream.length; i += FRAME_SAMPLES) {
      now += FRAME_MS
      const u = vad.push(stream.subarray(i, i + FRAME_SAMPLES), now)
      if (u) utts.push(u)
    }
    if (utts.length !== 1) { console.log(`FAIL ${c.file}: ${utts.length} utterances`); failed++; continue }
    const t0 = performance.now()
    const text = await ws.transcribe(pcmToWav(utts[0]!.pcm))
    const ms = Math.round(performance.now() - t0)
    const wake = checkWakeWord(text, { name: wakeWord })
    const ok = !isNoiseTranscript(text) && wake.ok === c.wake && c.expect.test(text)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.file}: "${text}" wake=${wake.ok} rest="${wake.rest}" whisper=${ms}ms utt=${(utts[0]!.pcm.length / 16000).toFixed(2)}s`)
  }
} finally {
  ws.stop()
}
process.exit(failed ? 1 : 0)

#!/usr/bin/env bun
// Build your voice print.
//   bun scripts/enroll.ts --from a.pcm b.pcm ...  enroll from raw 16 kHz s16le takes
//   bun scripts/enroll.ts --record 5              the voice server reads 5 lines aloud,
//                                                 you repeat each one; recorded from the default mic
// Only voiced audio counts: each take is cut into utterances by the same VAD the
// listener uses, and utterances under 1.5 s are skipped (noisy embeddings).
// Stop the listener first (`nixfredos-voice listen off`) so it does not hear the takes.
import { EnergyVad, FRAME_MS, FRAME_SAMPLES } from '../src/ears'
import { recordSeconds } from '../src/mic'
import { speakAndWait } from '../src/pulse'
import { VoicePrint, PRINT_FILE } from '../src/voiceprint'

const LINES = [
  'What is on my calendar today?',
  'Check the build on host two and tell me if it passed.',
  'Pull up the weather for this weekend.',
  'I want the notes from this morning in one place.',
  'How long until the next release?',
  'Turn the music down and remind me in ten minutes.',
  'What did we decide about the my-project voice server?',
  'Read me the last message from the team channel.',
]

function utterances(pcm: Int16Array): Int16Array[] {
  const vad = new EnergyVad()
  const out: Int16Array[] = []
  for (let i = 0, now = 0; i + FRAME_SAMPLES <= pcm.length; i += FRAME_SAMPLES) {
    now += FRAME_MS
    const u = vad.push(pcm.subarray(i, i + FRAME_SAMPLES), now)
    if (u && u.pcm.length >= 16000 * 1.5) out.push(u.pcm)
  }
  return out
}

const vp = new VoicePrint()
const clips: Int16Array[] = []
const i = process.argv.indexOf('--from')
if (i > 0) {
  const files = process.argv.slice(i + 1)
  const stop = files.findIndex(a => a.startsWith('--'))
  for (const f of stop < 0 ? files : files.slice(0, stop)) {
    const b = await Bun.file(f).arrayBuffer()
    const u = utterances(new Int16Array(b.slice(0, b.byteLength & ~1)))
    console.log(`${f}: ${u.length} voiced utterance(s)`)
    clips.push(...u)
  }
}
const r = process.argv.indexOf('--record')
if (r > 0) {
  const n = Math.min(Number(process.argv[r + 1] || 5), LINES.length)
  console.log(`Reading ${n} lines through the voice server. After each one, say it back.`)
  await speakAndWait(`Voice print. I will read ${n} lines. After each one, say it back to me.`)
  for (const line of LINES.slice(0, n)) {
    console.log(`  "${line}"`)
    await speakAndWait(line) // waits: the mic opens only after the line is done
    const u = utterances(recordSeconds(6))
    console.log(`    ${u.length} voiced utterance(s)`)
    clips.push(...u)
  }
  await speakAndWait('Got it. Thanks.')
}
if (!clips.length) { console.log('no voiced clips, nothing enrolled (need --from files or --record N)'); process.exit(1) }
const self = vp.enroll(clips)
console.log(`enrolled ${clips.length} clip(s) -> ${PRINT_FILE}; each clip vs centroid: ${self.join(' ')}`)

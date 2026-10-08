import { describe, expect, test } from 'bun:test'
import { EnergyVad, FRAME_MS, FRAME_SAMPLES, isNoiseTranscript, pcmToWav, rmsDbfs } from './ears'

// A frame of noise at roughly `db` dBFS (sine at that RMS level, plus jitter).
function frame(db: number, seed = 1): Int16Array {
  const amp = Math.pow(10, db / 20) * 32768 * Math.SQRT2
  const f = new Int16Array(FRAME_SAMPLES)
  for (let i = 0; i < f.length; i++) f[i] = Math.round(amp * Math.sin((i + seed) * 0.3))
  return f
}

function run(vad: EnergyVad, plan: Array<[number, number]>) {
  // plan: [dbfs, milliseconds]
  const out = []
  let now = 0
  for (const [db, ms] of plan) {
    for (let t = 0; t < ms; t += FRAME_MS) {
      now += FRAME_MS
      const u = vad.push(frame(db, now), now)
      if (u) out.push(u)
    }
  }
  return out
}

describe('rmsDbfs', () => {
  test('tracks level', () => {
    expect(Math.round(rmsDbfs(frame(-20)))).toBe(-20)
    expect(rmsDbfs(new Int16Array(480))).toBe(-120)
  })
})

describe('EnergyVad', () => {
  test('one utterance between quiet stretches, ended by 700 ms of quiet', () => {
    const u = run(new EnergyVad(), [[-55, 900], [-25, 1500], [-55, 1200]])
    expect(u.length).toBe(1)
    const ms = (u[0].pcm.length / FRAME_SAMPLES) * FRAME_MS
    expect(ms).toBeGreaterThan(1500) // speech + pre-roll + trailing quiet
    expect(ms).toBeLessThan(3000) // 1500 speech + 600 pre-roll + 700 trailing quiet
  })

  test('a short blip is dropped', () => {
    expect(run(new EnergyVad(), [[-55, 900], [-25, 150], [-55, 1200]]).length).toBe(0)
  })

  test('steady room noise never starts speech', () => {
    expect(run(new EnergyVad(), [[-45, 5000]]).length).toBe(0)
  })

  test('a short pause inside a sentence does not split it', () => {
    const u = run(new EnergyVad(), [[-55, 900], [-25, 800], [-55, 400], [-25, 800], [-55, 1200]])
    expect(u.length).toBe(1)
  })

  test('max length forces an end', () => {
    const u = run(new EnergyVad({ maxSpeechMs: 3000 }), [[-55, 900], [-25, 7000]])
    expect(u.length).toBe(2)
  })
})

describe('isNoiseTranscript', () => {
  test('whisper silence inventions', () => {
    for (const t of ['', ' ', '[BLANK_AUDIO]', '(music)', 'you', 'Thank you.', 'Thanks for watching.'])
      expect(isNoiseTranscript(t)).toBe(true)
    expect(isNoiseTranscript('Computer, thank you.')).toBe(false)
  })
})

describe('pcmToWav', () => {
  test('44-byte header, mono 16 kHz', () => {
    const w = pcmToWav(new Int16Array(16000))
    expect(w.length).toBe(44 + 32000)
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe('RIFF')
    expect(new DataView(w.buffer).getUint32(24, true)).toBe(16000)
  })
})

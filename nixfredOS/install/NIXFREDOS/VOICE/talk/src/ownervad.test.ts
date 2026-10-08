import { describe, expect, test } from 'bun:test'
import { OwnerVad } from './ownervad'
import { FRAME_MS, FRAME_SAMPLES } from './ears'

// Frames tagged by who is "talking": the fake scorer reads the tag back from
// the first sample of the newest frame in the window. -25 dBFS-ish loud frames.
const TAG = { tv: 1000, owner: 2000, mix: 3000, silence: 0 }
function frame(kind: keyof typeof TAG): Int16Array {
  const f = new Int16Array(FRAME_SAMPLES)
  if (kind === 'silence') return f
  for (let i = 0; i < f.length; i++) f[i] = Math.round(1500 * Math.sin(i * 0.3))
  f[0] = TAG[kind]
  return f
}
const scorer = (pcm: Int16Array) => {
  // score by the majority of tagged frames in the window
  let owner = 0, n = 0
  for (let i = 0; i < pcm.length; i += FRAME_SAMPLES) { const t = pcm[i]; if (t === TAG.owner || t === TAG.mix) owner++; n++ }
  return owner / n > 0.5 ? 0.6 : 0.1
}

function run(plan: Array<[keyof typeof TAG, number]>) {
  const v = new OwnerVad(scorer)
  const out = []
  let now = 0
  for (const [kind, ms] of plan) for (let t = 0; t < ms; t += FRAME_MS) {
    now += FRAME_MS
    const u = v.push(frame(kind), now)
    if (u) out.push({ ...u, ms: (u.pcm.length / FRAME_SAMPLES) * FRAME_MS })
  }
  return out
}

describe('OwnerVad', () => {
  test('nonstop TV alone never makes a segment', () => {
    expect(run([['tv', 20000]]).length).toBe(0)
  })

  test('The user talking over nonstop TV is cut out as one segment', () => {
    const u = run([['tv', 4000], ['mix', 3000], ['tv', 4000]])
    expect(u.length).toBe(1)
    expect(u[0].ms).toBeGreaterThan(2500)
    expect(u[0].ms).toBeLessThan(6000) // not the whole 11 s of TV
  })

  test('the segment ends about a second after The user stops, while the TV keeps going', () => {
    const u = run([['tv', 3000], ['mix', 2500], ['tv', 6000]])
    expect(u.length).toBe(1)
    expect(u[0].endedAt - u[0].voicedEndAt).toBeLessThan(1500)
    expect(u[0].endedAt).toBeLessThan(3000 + 2500 + 2500)
  })

  test('two questions with TV between are two segments', () => {
    expect(run([['tv', 2000], ['mix', 2000], ['tv', 3000], ['mix', 2000], ['tv', 3000]]).length).toBe(2)
  })

  test('The user in a quiet room works too', () => {
    expect(run([['silence', 2000], ['owner', 2500], ['silence', 2000]]).length).toBe(1)
  })

  test('abort drops a segment in progress (the assistant started talking)', () => {
    const v = new OwnerVad(scorer)
    let now = 0, got = 0
    for (let t = 0; t < 3000; t += FRAME_MS) { now += FRAME_MS; if (v.push(frame('owner'), now)) got++ }
    v.abort()
    for (let t = 0; t < 3000; t += FRAME_MS) { now += FRAME_MS; if (v.push(frame('tv'), now)) got++ }
    expect(got).toBe(0)
  })
})


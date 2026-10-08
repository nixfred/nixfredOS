// Voice print: "is this the enrolled user?" before any transcription.
// sherpa-onnx speaker embeddings (3D-Speaker ERes2Net, English VoxCeleb,
// 192-dim, ~60 ms per 3 s on CPU), cosine against the centroid of the user's
// enrollment clips. Measured with one speaker: same voice 0.56-0.74, another
// voice 0.04-0.11. The 0.35 threshold is provisional until tuned on real TV audio.
import sherpa from 'sherpa-onnx-node'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { PATHS, SPEAKER_MODEL } from './config'

export const MODEL = join(PATHS.models, SPEAKER_MODEL)
export const PRINT_FILE = PATHS.voiceprint
export const DEFAULT_THRESHOLD = 0.35

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let d = 0, x = 0, y = 0
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]! }
  return d / Math.sqrt(x * y || 1)
}

function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map(x => x / n)
}

export class VoicePrint {
  private ex: any
  centroid: number[] | null = null
  threshold = DEFAULT_THRESHOLD

  constructor(model = MODEL) {
    if (!existsSync(model)) throw new Error(`voiceprint model missing: ${model} (run scripts/setup.ts)`)
    this.ex = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: 2, debug: false, provider: 'cpu' })
    if (existsSync(PRINT_FILE)) {
      const j = JSON.parse(readFileSync(PRINT_FILE, 'utf8'))
      this.centroid = j.centroid
      this.threshold = j.threshold ?? DEFAULT_THRESHOLD
    }
  }

  get enrolled() { return !!this.centroid }

  embed(pcm: Int16Array): Float32Array {
    const f = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768
    const st = this.ex.createStream()
    st.acceptWaveform({ sampleRate: 16000, samples: f })
    return normalize(this.ex.compute(st))
  }

  /** Cosine similarity of this utterance to the enrolled centroid. */
  score(pcm: Int16Array): number {
    if (!this.centroid) return 1
    return cosine(this.embed(pcm), this.centroid)
  }

  /** Average the normalized embeddings of the user's clips and save the centroid (0600). */
  enroll(clips: Int16Array[], threshold = this.threshold) {
    const embs = clips.map(c => this.embed(c))
    const dim = embs[0]!.length
    const c = new Float32Array(dim)
    for (const e of embs) for (let i = 0; i < dim; i++) c[i] = c[i]! + e[i]! / embs.length
    this.centroid = Array.from(normalize(c))
    this.threshold = threshold
    const selfScores = embs.map(e => +cosine(e, this.centroid!).toFixed(3))
    mkdirSync(dirname(PRINT_FILE), { recursive: true, mode: 0o700 })
    writeFileSync(PRINT_FILE, JSON.stringify({ created: new Date().toISOString(), clips: clips.length, threshold, selfScores, centroid: this.centroid }), { mode: 0o600 })
    chmodSync(PRINT_FILE, 0o600) // writeFileSync's mode only applies to new files
    return selfScores
  }
}

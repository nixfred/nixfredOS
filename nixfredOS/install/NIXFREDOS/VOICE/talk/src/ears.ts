// Ears, the pure part: voice activity detection on 16 kHz mono s16le frames
// and WAV packing. No I/O here, so it is testable (see ears.test.ts). The wake
// word lives in wake.ts, mic capture in mic.ts, transcription in whisper.ts.

export const SAMPLE_RATE = 16000
export const FRAME_MS = 30
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000 // 480
export const FRAME_BYTES = FRAME_SAMPLES * 2

export function rmsDbfs(frame: Int16Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  const rms = Math.sqrt(sum / Math.max(1, frame.length)) / 32768
  return rms > 0 ? 20 * Math.log10(rms) : -120
}

export interface VadOptions {
  startAboveFloorDb: number // speech starts this far above the noise floor...
  startFrames: number       // ...for this many frames in a row
  endAboveFloorDb: number   // speech continues while above floor + this
  endSilenceMs: number      // this much quiet ends the utterance (end of turn)
  minSpeechMs: number       // shorter blips are dropped (coughs, clicks)
  maxSpeechMs: number       // force an end so one utterance cannot run forever
  preRollMs: number         // keep this much audio from before the start
  minStartDbfs: number      // never start below this absolute level
}

// Tuned on a laptop from a real capture: the room sat near -43 dBFS and
// jittered about ±4 dB; speech through the laptop speakers peaked only 8-12 dB
// above it, and soft starts (a quietly said wake word) lower still.
export const DEFAULT_VAD: VadOptions = {
  startAboveFloorDb: 7,
  startFrames: 2,
  endAboveFloorDb: 4,
  endSilenceMs: 700,
  minSpeechMs: 400,
  maxSpeechMs: 15000,
  preRollMs: 600,
  minStartDbfs: -55,
}

const FLOOR_WINDOW = 100      // 3 s of quiet frames
const FLOOR_PERCENTILE = 0.2  // robust to jitter and clicks
const SKIP_FRAMES = 8         // pw-record start-up transient (~240 ms)
const CALIBRATE_FRAMES = 15   // then 450 ms to learn the room

export interface Utterance {
  pcm: Int16Array
  startedAt: number // ms timestamp of the first speech frame
  voicedEndAt: number // ms timestamp of the last frame that still sounded like speech
  endedAt: number   // ms timestamp when the end of turn was detected
}

// Energy VAD with a percentile noise floor. Good enough for a quiet room with a
// wake word behind it; Silero (whisper-server --vad) cleans up each utterance.
export class EnergyVad {
  private o: VadOptions
  private floor = -60
  private seen = 0
  private quietLevels: number[] = []
  private inSpeech = false
  private loudRun = 0
  private quietMs = 0
  private speechFrames: Int16Array[] = []
  private preRoll: Int16Array[] = []
  private startedAt = 0
  private voicedEndAt = 0

  constructor(opts: Partial<VadOptions> = {}) {
    this.o = { ...DEFAULT_VAD, ...opts }
  }

  get noiseFloor() { return this.floor }
  get speaking() { return this.inSpeech }

  /** Throw away any utterance in progress (the assistant started talking: half-duplex). */
  abort() { this.reset() }

  /** Feed one 30 ms frame. Returns an utterance when an end of turn is detected. */
  push(frame: Int16Array, now: number): Utterance | null {
    const db = rmsDbfs(frame)
    const o = this.o

    // Skip the recorder's start-up click, then only learn the room for 450 ms.
    this.seen++
    if (this.seen <= SKIP_FRAMES) return null
    if (this.seen <= SKIP_FRAMES + CALIBRATE_FRAMES) {
      this.learnQuiet(db)
      this.remember(frame)
      return null
    }

    if (!this.inSpeech) {
      const loud = db > this.floor + o.startAboveFloorDb && db > o.minStartDbfs
      this.loudRun = loud ? this.loudRun + 1 : 0
      this.remember(frame)
      if (!loud) this.learnQuiet(db) // drift with the room while quiet
      if (this.loudRun >= o.startFrames) {
        this.inSpeech = true
        this.quietMs = 0
        this.startedAt = now - o.startFrames * FRAME_MS
        this.voicedEndAt = now
        this.speechFrames = [...this.preRoll]
        this.preRoll = []
      }
      return null
    }

    this.speechFrames.push(frame)
    const voiced = db > this.floor + o.endAboveFloorDb
    if (voiced) this.voicedEndAt = now
    this.quietMs = voiced ? 0 : this.quietMs + FRAME_MS
    const spokenMs = now - this.startedAt
    if (this.quietMs >= o.endSilenceMs || spokenMs >= o.maxSpeechMs) {
      const frames = this.speechFrames
      const voicedMs = spokenMs - this.quietMs // read before reset() zeroes quietMs
      const startedAt = this.startedAt
      this.reset()
      if (voicedMs < o.minSpeechMs) return null
      return { pcm: concat(frames), startedAt, endedAt: now, voicedEndAt: this.voicedEndAt }
    }
    return null
  }

  private learnQuiet(db: number) {
    this.quietLevels.push(db)
    if (this.quietLevels.length > FLOOR_WINDOW) this.quietLevels.shift()
    const sorted = [...this.quietLevels].sort((a, b) => a - b)
    this.floor = sorted[Math.floor((sorted.length - 1) * FLOOR_PERCENTILE)]
  }

  private remember(frame: Int16Array) {
    this.preRoll.push(frame)
    const keep = Math.ceil(this.o.preRollMs / FRAME_MS)
    if (this.preRoll.length > keep) this.preRoll.shift()
  }

  private reset() {
    this.inSpeech = false
    this.loudRun = 0
    this.quietMs = 0
    this.speechFrames = []
    this.preRoll = []
  }
}

export function concat(frames: Int16Array[]): Int16Array {
  const out = new Int16Array(frames.reduce((n, f) => n + f.length, 0))
  let off = 0
  for (const f of frames) { out.set(f, off); off += f.length }
  return out
}

/** Pack mono 16-bit PCM as a WAV file for whisper-server. */
export function pcmToWav(pcm: Int16Array, rate = SAMPLE_RATE): Uint8Array {
  const data = pcm.length * 2
  const buf = new ArrayBuffer(44 + data)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, data, true)
  new Int16Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}

// What whisper invents over silence or noise.
const NOISE = /^\s*(?:\[[^\]]*\]|\([^)]*\)|you\.?|thank you\.?|thanks for watching\.?|bye\.?)\s*$/i
export const isNoiseTranscript = (text: string) => !text.trim() || NOISE.test(text)

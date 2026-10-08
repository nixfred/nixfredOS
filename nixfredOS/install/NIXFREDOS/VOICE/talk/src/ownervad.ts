// Personal VAD: finds where the ENROLLED USER is talking inside continuous sound.
// The energy VAD ends an utterance on 700 ms of quiet, but a TV never goes
// quiet: a spoken command got merged with TV dialogue into one 15.6 s chunk and
// was dropped. Here the edges come from the voice print instead: every hop, the
// last window is scored against the user's print. The scorer is injected so
// this stays pure and testable.
import { concat, FRAME_MS, rmsDbfs, type Utterance } from './ears'

export interface OwnerVadOptions {
  windowMs: number     // audio scored each hop
  hopMs: number        // how often to score (a multiple of FRAME_MS)
  startScore: number   // a window this much like the user starts a segment
  keepScore: number    // lower bar to keep it going (hysteresis)
  endGraceMs: number   // no user-like window for this long ends the segment
  preRollMs: number    // audio kept from before the first matching window
  tailMs: number       // audio kept after the last matching window
  minDbfs: number      // quieter windows are not scored (silence)
  maxMs: number        // force an end
}

// Live scores measured with one enrolled speaker: that speaker 0.57-0.72; TV and
// other people -0.13..0.30 (95 chunks). Short windows are noisier, hence the
// hysteresis. Re-tune for your own voice and room.
export const DEFAULT_OWNER_VAD: OwnerVadOptions = {
  windowMs: 1500,
  hopMs: 450,
  startScore: 0.42,
  keepScore: 0.32,
  endGraceMs: 900,
  preRollMs: 600,
  tailMs: 300,
  minDbfs: -52,
  maxMs: 20000,
}

export interface OwnerUtterance extends Utterance { ownerScore: number }

export class OwnerVad {
  private o: OwnerVadOptions
  private frames: Int16Array[] = []
  private times: number[] = []
  private sinceHop = 0
  private active = false
  private segStart = 0      // index into frames
  private lastOwner = 0      // index of the last frame of the last matching window
  private lastOwnerAt = 0
  private startedAt = 0
  private best = 0

  constructor(private scorer: (pcm: Int16Array) => number, opts: Partial<OwnerVadOptions> = {}) {
    this.o = { ...DEFAULT_OWNER_VAD, ...opts }
  }

  get speaking() { return this.active }

  abort() {
    this.active = false
    this.frames = []
    this.times = []
    this.sinceHop = 0
  }

  push(frame: Int16Array, now: number): OwnerUtterance | null {
    const o = this.o
    this.frames.push(frame)
    this.times.push(now)
    if (++this.sinceHop * FRAME_MS < o.hopMs) return this.trim(null)
    this.sinceHop = 0

    const winFrames = Math.ceil(o.windowMs / FRAME_MS)
    if (this.frames.length < winFrames) return null
    const last = this.frames.length - 1
    const win = concat(this.frames.slice(-winFrames))
    const loud = rmsDbfs(win) > o.minDbfs
    const score = loud ? this.scorer(win) : -1

    if (!this.active) {
      if (score >= o.startScore) {
        this.active = true
        this.segStart = Math.max(0, last - winFrames - Math.ceil(o.preRollMs / FRAME_MS) + 1)
        this.startedAt = this.times[this.segStart]
        this.lastOwner = last
        this.lastOwnerAt = now
        this.best = score
      }
      return this.trim(null)
    }

    if (score >= o.keepScore) { this.lastOwner = last; this.lastOwnerAt = now; this.best = Math.max(this.best, score) }
    const quietFor = now - this.lastOwnerAt
    const tooLong = now - this.startedAt >= o.maxMs
    if (quietFor < o.endGraceMs && !tooLong) return null

    const end = Math.min(this.frames.length, this.lastOwner + 1 + Math.ceil(o.tailMs / FRAME_MS))
    const u: OwnerUtterance = {
      pcm: concat(this.frames.slice(this.segStart, end)),
      startedAt: this.startedAt,
      voicedEndAt: this.lastOwnerAt,
      endedAt: now,
      ownerScore: this.best,
    }
    this.active = false
    this.frames = this.frames.slice(end)
    this.times = this.times.slice(end)
    return u
  }

  // Keep only what a future segment could need (window + pre-roll) while idle.
  private trim<T>(r: T): T {
    if (!this.active) {
      const keep = Math.ceil((this.o.windowMs + this.o.preRollMs) / FRAME_MS) + 2
      if (this.frames.length > keep * 2) {
        this.frames = this.frames.slice(-keep)
        this.times = this.times.slice(-keep)
      }
    }
    return r
  }
}

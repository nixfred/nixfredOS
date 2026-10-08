// Wake word, pure. The wake word is the assistant's own name (voice.json
// "wake_word", else the DA identity name, else "Computer"). It must open EVERY
// utterance, so anything without it is dropped: TV, YouTube, other people.

export const DEFAULT_WAKE_WORD = 'Computer'

export interface WakeResult { ok: boolean; rest: string; heard: string }
export interface WakeOptions {
  name?: string          // the wake word; default "Computer"
  loose?: boolean        // near-misses count; ONLY when the voice print already confirmed the user
  maxLeadWords?: number  // loose mode: the name must be among the first N words (default 4)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whisper-friendly text for comparison: lowercase letters, digits and apostrophes only. */
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/'s$/, '')

/**
 * Strict matcher: optional "hey/ok/..." then the name (optionally possessive),
 * at the very start. Multi-word names ("Hey Jarvis" style) match across
 * flexible whitespace.
 */
export function buildStrictWake(name: string): RegExp {
  const words = name.trim().split(/\s+/).filter(Boolean).map(escapeRe)
  const body = words.join('[\\s,.-]+')
  return new RegExp(`^[\\s"'.,!?-]*(?:(?:hey|hi|ok|okay|yo|so)[\\s,.!]+)?(?:${body})(?:'s)?\\b[\\s,.!?:;-]*`, 'i')
}

/** Levenshtein distance, small strings only. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]!
}

/** Edit distance a loose match may be off by: 2 for names of 4+ characters, else exact. */
export function looseTolerance(name: string): number {
  return norm(name).replace(/\s+/g, '').length >= 4 ? 2 : 0
}

// Loose mode: once the voice print has said "this is the user", whisper's
// near-misses count too ("Computer, what time?" heard as "Commuter, what
// time?"). The name may also come a few words in, after TV words that slipped
// into the pre-roll. Never used for audio that is not the enrolled user's.
// Single-word names only; a multi-word name falls back to strict matching.
export function checkWakeWord(text: string, opts: WakeOptions = {}): WakeResult {
  const name = (opts.name ?? DEFAULT_WAKE_WORD).trim() || DEFAULT_WAKE_WORD
  const heard = text.trim()
  const m = buildStrictWake(name).exec(heard)
  if (m) return { ok: true, rest: heard.slice(m[0].length).trim(), heard }
  if (!opts.loose || /\s/.test(name)) return { ok: false, rest: '', heard }

  const want = norm(name)
  const tol = looseTolerance(name)
  const lead = opts.maxLeadWords ?? 4
  const re = /\S+/g
  let w: RegExpExecArray | null
  for (let n = 0; n < lead && (w = re.exec(heard)); n++) {
    const got = norm(w[0])
    if (got && editDistance(got, want) <= tol) {
      return { ok: true, rest: heard.slice(w.index + w[0].length).replace(/^[\s,.!?:;-]+/, '').trim(), heard }
    }
  }
  return { ok: false, rest: '', heard }
}

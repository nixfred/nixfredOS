// The text the listener types: the microphone mark, the machine that heard you,
// then your words: "🎙️ laptop: what time is it". The origin tag lets the
// session answer on the machine you are sitting at, which is not always the one
// the session runs on (ssh + herdr). Hooks parse it back with the same pattern
// (hooks/lib/voice-switch.ts parseSpokenPrompt). Pure, so tests can import it.

export const SPOKEN_MARK = '🎙️'

/** A host name that is safe to hand to ssh: no leading "-", no spaces or shell syntax. */
export const ORIGIN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/

export function spokenPrompt(words: string, origin?: string): string {
  const w = words.trim()
  return origin && ORIGIN_RE.test(origin) ? `${SPOKEN_MARK} ${origin}: ${w}` : `${SPOKEN_MARK} ${w}`
}

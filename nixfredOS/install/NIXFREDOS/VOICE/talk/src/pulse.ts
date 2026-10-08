// Voice server (Pulse) client: speak a line, and the echo guard.
import { VOICE_SERVER } from './config'

/** Base URL of the voice server (PULSE_URL overrides, read per call). */
export const voiceServer = () => VOICE_SERVER

export interface Speaking { speaking: boolean; pending?: number; last_end: number }

export async function getSpeaking(base = voiceServer()): Promise<Speaking> {
  const res = await fetch(`${base}/speaking`, { signal: AbortSignal.timeout(1500) })
  return await res.json() as Speaking
}

/** Fire and forget: speak a line through the voice server. */
export function notify(message: string, title = 'Voice', base = voiceServer()): void {
  fetch(`${base}/notify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, title, progress: true }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {})
}

/** Speak and wait until the voice server is quiet again (used by enrollment). */
export async function speakAndWait(message: string, title = 'Voice', base = voiceServer(), maxMs = 30000): Promise<void> {
  notify(message, title, base)
  const until = Date.now() + maxMs
  await Bun.sleep(600) // let the line reach the queue
  while (Date.now() < until) {
    try { const s = await getSpeaking(base); if (!s.speaking && !(s.pending && s.pending > 0)) return } catch { return }
    await Bun.sleep(200)
  }
}

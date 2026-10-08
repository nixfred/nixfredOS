/**
 * voice-switch.ts — the voice on/off switch and spoken-turn flag, shared by hooks.
 *
 * Switch: <configRoot>/voice.json  {"enabled": bool, "listen"?: bool, "speaker"?: host, ...}
 * "listen": the microphone listener runs here, and prompts it typed are answered
 * aloud even when "enabled" (agent voice) is false.
 * Fail closed: a missing, unreadable or invalid file means OFF. The env var
 * NIXFREDOS_VOICE=off forces OFF regardless of the file. Headless and subagent
 * contexts are gated separately by notification-channel.ts and subagent.ts.
 *
 * Spoken turn: a prompt that begins with the microphone emoji was spoken by the
 * user through the listener: "🎙️ <origin host>: <words>" (older listeners send
 * "🎙️ <words>"). The origin is the machine that heard the user, where the
 * answer should play. PromptProcessing writes a per-session flag so the
 * Stop hook does not speak a second, redundant completion line.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getClaudeDir } from './paths';

export const SPOKEN_PREFIX = '🎙️';

export interface VoiceSwitch {
  enabled: boolean;
  listen?: boolean;
  speaker?: string;
}

export function readVoiceSwitch(): VoiceSwitch {
  try {
    const c = JSON.parse(readFileSync(join(getClaudeDir(), 'voice.json'), 'utf-8'));
    if (!c || typeof c !== 'object') return { enabled: false };
    const speaker = typeof c.speaker === 'string' && c.speaker.trim() ? c.speaker.trim() : undefined;
    return { enabled: c.enabled === true, listen: c.listen === true, speaker };
  } catch {
    return { enabled: false };
  }
}

/** True only when voice.json says enabled AND the env override is not "off". */
export function isVoiceEnabled(): boolean {
  if ((process.env.NIXFREDOS_VOICE || '').toLowerCase() === 'off') return false;
  return readVoiceSwitch().enabled;
}

export function isSpokenPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(SPOKEN_PREFIX);
}

/**
 * The machine that heard a spoken prompt, from "🎙️ <host>: <words>", or null
 * (no tag, or not safe to hand to ssh). Same pattern as the listener's
 * NIXFREDOS/VOICE/talk/src/spoken.ts.
 */
export function spokenOrigin(prompt: string): string | null {
  const m = /^\u{1F399}\u{FE0F}?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,62}):\s/u.exec(prompt.trimStart());
  return m ? m[1]! : null;
}

function flagPath(sessionId: string): string {
  const state = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(state, 'nixfredos-voice', `spoken-turn-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}`);
}

export function setSpokenTurnFlag(sessionId: string): void {
  try {
    const p = flagPath(sessionId);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, String(Date.now()));
  } catch { /* best-effort */ }
}

/** Returns true if the flag existed; always removes it. */
export function consumeSpokenTurnFlag(sessionId: string): boolean {
  const p = flagPath(sessionId);
  if (!existsSync(p)) return false;
  try { unlinkSync(p); } catch { /* already gone */ }
  return true;
}

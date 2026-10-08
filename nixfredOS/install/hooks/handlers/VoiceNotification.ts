/**
 * VoiceNotification.ts - Voice Notification Handler
 *
 * PURPOSE:
 * Sends completion messages to the Pulse voice endpoint (POST /notify).
 * The engine (ElevenLabs or an OS-native fallback) is chosen by the server.
 *
 * Pure handler: receives pre-parsed transcript data, sends to voice server.
 * No I/O for transcript reading - that's done by VoiceCompletion.hook.ts.
 */

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { paiPath } from '../lib/paths';
import { getIdentity } from '../lib/identity';
import { getISOTimestamp } from '../lib/time';
import { isValidVoiceCompletion, getVoiceFallback } from '../lib/output-validators';
import { findActiveSessionByUUID } from '../lib/isa-utils';

import type { ParsedTranscript } from '../../NIXFREDOS/TOOLS/TranscriptParser';
import { PULSE_BASE } from '../../NIXFREDOS/PULSE/endpoint';

const DA_IDENTITY = getIdentity();

// POST /notify payload. voice_id is omitted: the server resolves the voice
// from ~/.claude/voice.json, then the assistant identity.
interface NotificationPayload {
  message: string;
  title?: string;
  progress?: boolean;
  voice_enabled?: boolean;
}

interface VoiceEvent {
  timestamp: string;
  session_id: string;
  event_type: 'sent' | 'failed' | 'skipped';
  message: string;
  character_count: number;
  voice_engine: 'pulse';
  status_code?: number;
  error?: string;
}

const VOICE_LOG_PATH = paiPath('MEMORY', 'VOICE', 'voice-events.jsonl');

/**
 * Resolve the active session's work dir for echoing voice events into a
 * per-session `voice.jsonl`. Source of truth is MEMORY/STATE/work.json,
 * matched by sessionUUID. Returns null when no active row exists — the
 * voice event still lands in the global voice-events.jsonl above.
 */
function getActiveWorkDir(sessionId: string): string | null {
  try {
    const active = findActiveSessionByUUID(sessionId);
    if (!active) return null;
    const workPath = paiPath('MEMORY', 'WORK', active.slug);
    return existsSync(workPath) ? workPath : null;
  } catch {
    return null;
  }
}

function logVoiceEvent(event: VoiceEvent): void {
  const line = JSON.stringify(event) + '\n';

  try {
    const dir = paiPath('MEMORY', 'VOICE');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(VOICE_LOG_PATH, line);
  } catch {
    // Silent fail
  }

  try {
    const workDir = event.session_id ? getActiveWorkDir(event.session_id) : null;
    if (workDir) {
      appendFileSync(join(workDir, 'voice.jsonl'), line);
    }
  } catch {
    // Silent fail
  }
}

async function sendNotification(payload: NotificationPayload, sessionId: string): Promise<void> {
  const baseEvent: Omit<VoiceEvent, 'event_type' | 'status_code' | 'error'> = {
    timestamp: getISOTimestamp(),
    session_id: sessionId,
    message: payload.message,
    character_count: payload.message.length,
    voice_engine: 'pulse',
  };

  try {
    const response = await fetch(`${PULSE_BASE}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000), // cloud TTS takes a few seconds; leave headroom
    });

    if (!response.ok) {
      console.error('[Voice] Server error:', response.statusText);
      logVoiceEvent({
        ...baseEvent,
        event_type: 'failed',
        status_code: response.status,
        error: response.statusText,
      });
    } else {
      // The server answers {status:"off"} when the voice switch is OFF.
      const body: any = await response.json().catch(() => ({}));
      logVoiceEvent({
        ...baseEvent,
        event_type: body?.status === 'off' ? 'skipped' : 'sent',
        status_code: response.status,
      });
    }
  } catch (error) {
    console.error('[Voice] Failed to send:', error);
    logVoiceEvent({
      ...baseEvent,
      event_type: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle voice notification with pre-parsed transcript data.
 * The server speaks it, or stays silent when the voice switch is OFF.
 */
export async function handleVoice(parsed: ParsedTranscript, sessionId: string): Promise<void> {
  let voiceCompletion = parsed.voiceCompletion;

  // Validate voice completion
  if (!isValidVoiceCompletion(voiceCompletion)) {
    console.error(`[Voice] Invalid completion: "${voiceCompletion.slice(0, 50)}..."`);
    voiceCompletion = getVoiceFallback();
  }

  // Skip empty or too-short messages
  if (!voiceCompletion || voiceCompletion.length < 5) {
    console.error('[Voice] Skipping - message too short or empty');
    return;
  }

  const payload: NotificationPayload = {
    message: voiceCompletion,
    title: `${DA_IDENTITY.name} says`,
    voice_enabled: true,
  };

  await sendNotification(payload, sessionId);
}

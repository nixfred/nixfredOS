#!/usr/bin/env bun
/**
 * @version 1.4.7
 * VoiceCompletion.hook.ts — Send completion voice line to TTS server
 *
 * PURPOSE:
 * Extracts the 🗣️ voice line from Claude's response and sends it to
 * the Pulse voice endpoint for spoken playback (ElevenLabs or an OS-native
 * engine, chosen by the server).
 *
 * TRIGGER: Stop
 *
 * NEEDS TRANSCRIPT: Yes (for voice line extraction)
 *
 * VOICE GATE: Only fires for main terminal sessions (not subagents).
 * Also obeys the voice switch (~/.claude/voice.json, fail-closed) and skips
 * turns the user spoke through the listener: PromptProcessing already told the
 * assistant to answer aloud first, so a second completion line would repeat it.
 *
 * HANDLER: handlers/VoiceNotification.ts
 */

import { readHookInput, parseTranscriptFromInput } from './lib/hook-io';
import { handleVoice } from './handlers/VoiceNotification';
import { extractVoiceCompletion } from '../NIXFREDOS/TOOLS/TranscriptParser';
import { isDesktopChannel, logSkippedVoice, getNotificationChannel } from './lib/notification-channel';
import { isVoiceEnabled, consumeSpokenTurnFlag } from './lib/voice-switch';

/**
 * Extract a speakable summary from response text when no 🗣️ line exists.
 * Tries structured markers first, then falls back to first sentence.
 */
function extractFallbackSummary(text: string): string {
  // Strip system-reminder tags
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');

  // Try SUMMARY line
  const summaryMatch = text.match(/📋\s*\*{0,2}SUMMARY:?\*{0,2}\s*(.+?)(?:\n|$)/i);
  if (summaryMatch?.[1]) {
    const summary = summaryMatch[1].trim();
    if (summary.length >= 10 && summary.length <= 200) return summary;
  }

  // Try CHANGE/VERIFY bullets (take first one)
  const changeMatch = text.match(/🔧\s*\*{0,2}CHANGE:?\*{0,2}\s*(.+?)(?:\n|$)/i);
  if (changeMatch?.[1]) {
    const change = changeMatch[1].trim();
    if (change.length >= 10 && change.length <= 200) return change;
  }

  // Last resort: first sentence that looks like a summary (>20 chars, ends with period)
  const sentences = text.split(/[.!?]\s/);
  for (const s of sentences) {
    const clean = s.replace(/[#*_`~>\[\](){}|]/g, '').trim();
    if (clean.length >= 20 && clean.length <= 150 && !/^[═━─╌]/.test(clean)) {
      return clean + '.';
    }
  }

  return '';
}

/**
 * Voice gate: only main terminal sessions get voice.
 * Subagents spawned via Task tool have CLAUDE_CODE_AGENT_TASK_ID set.
 * The old kitty-sessions file check was unreliable — new sessions
 * had no file and were incorrectly blocked.
 */
function isMainSession(): boolean {
  // Subagents set this env var; main sessions don't
  return !process.env.CLAUDE_CODE_AGENT_TASK_ID;
}

async function main() {
  const input = await readHookInput();
  if (!input) { process.exit(0); }

  // Voice gate: skip subagent sessions
  if (!isMainSession()) {
    console.error('[VoiceCompletion] Voice OFF (not main session)');
    process.exit(0);
  }

  // Channel gate: desktop /notify must not fire when the session is running
  // on behalf of a remote channel (iMessage, Siri). Those channels deliver
  // replies via their own APIs. See hooks/lib/notification-channel.ts.
  if (!isDesktopChannel()) {
    const channel = getNotificationChannel();
    console.error(`[VoiceCompletion] Voice OFF (remote channel: ${channel})`);
    logSkippedVoice({ hookLabel: 'VoiceCompletion', message: '', sessionId: input.session_id });
    process.exit(0);
  }

  // Spoken turn: the answer was already voiced in the first action. Always
  // delete the flag so it cannot suppress the next turn.
  if (consumeSpokenTurnFlag(input.session_id)) {
    console.error('[VoiceCompletion] Skipping (spoken turn, already answered aloud)');
    process.exit(0);
  }

  // Voice switch: OFF (or missing/invalid voice.json) means silence.
  if (!isVoiceEnabled()) {
    console.error('[VoiceCompletion] Voice OFF (voice.json)');
    process.exit(0);
  }

  const parsed = await parseTranscriptFromInput(input);

  // Fallback: if transcript parsing found no voice line, try last_assistant_message
  if (!parsed.voiceCompletion && input.last_assistant_message) {
    const fromLastMsg = extractVoiceCompletion(input.last_assistant_message);
    if (fromLastMsg) {
      parsed.voiceCompletion = fromLastMsg;
    } else {
      // Final fallback: extract first meaningful sentence from last_assistant_message.
      // Log it — a silent fallback spoke CHANGE bullets for six days on one
      // install before anyone noticed. (public issue #1829, @MatiasBarboza)
      console.error('[VoiceCompletion] no 🗣️ line extracted — falling back to summary extraction');
      const fallback = extractFallbackSummary(input.last_assistant_message);
      if (fallback) {
        parsed.voiceCompletion = fallback;
      }
    }
  }

  try {
    await handleVoice(parsed, input.session_id);
  } catch (err) {
    console.error('[VoiceCompletion] Handler failed:', err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[VoiceCompletion] Fatal:', err);
  process.exit(0);
});

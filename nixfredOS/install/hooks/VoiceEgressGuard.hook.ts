#!/usr/bin/env bun
/**
 * @version 1.0.1
 * VoiceEgressGuard.hook.ts — no terminal, no voice.
 *
 * PURPOSE:
 * Scheduled/headless claude sessions (launchd sweeps, evals, cadence jobs)
 * load skills whose workflows curl the Pulse voice speaker endpoints
 * directly — ~500 call sites across SKILL.md/workflow files. Per-caller
 * `voice_enabled: false` discipline cannot hold at that scale (it failed
 * twice on 2026-08-14 alone), so this guard closes the class at the one
 * choke point every in-session call traverses: the Bash tool.
 *
 * RULE: a Bash command targeting a voice SPEAKER endpoint is blocked
 * whenever the session's notification channel is not 'desktop' (headless
 * sniff + spawner marking live in lib/notification-channel.ts). Health
 * checks (/voice/health) always pass — monitors legitimately probe them.
 *
 * WIRING: runs inside PreToolGuard.hook.ts (the ONE PreToolUse blocking
 * dispatcher) via the exported check(). Fail-OPEN on any internal anomaly,
 * matching the dispatcher's isolation contract.
 */

import { readFileSync } from "node:fs";
import { isDesktopChannel, getNotificationChannel, logSkippedVoice } from "./lib/notification-channel";
import { isSubagentContext } from "./lib/subagent";

type BlockResult = { block: true; message: string } | null;

// Speaker-reaching endpoints: /notify and its /notify/personality alias.
// Deliberately NOT /speaking or /voice/health (monitors and the listener poll
// them). Port 31337 is the Pulse server.
const SPEAKER_ENDPOINT = /(?:localhost|127\.0\.0\.1):31337\/notify/;

// The CLI wrapper: `nixfredos-voice say ...` or `nixfredos-voice test`, as a
// command word (start of line or after a shell separator), not inside a path.
const SPEAKER_CLI = /(?:^|[\s;&|(`])(?:\S*\/)?nixfredos-voice\s+(?:say|test)\b/;

export function check(input: any): BlockResult {
  const command = input?.tool_input?.command;
  if (typeof command !== "string") return null;
  const viaCli = SPEAKER_CLI.test(command);
  if (!SPEAKER_ENDPOINT.test(command) && !viaCli) return null;

  // Subagents never speak: the main session is the only voice. This covers the
  // `nixfredos-voice say|test` CLI (the curl path stays channel-gated only).
  if (viaCli && isSubagentContext()) {
    return {
      block: true,
      message:
        "[VoiceEgressGuard] blocked voice call: subagents never speak, only the main session does. " +
        "Skip the announcement and continue with the task.\n",
    };
  }
  if (isDesktopChannel()) return null;

  // Explicitly-silent notifications stay allowed: a scheduled job may post a
  // banner-only /notify with voice_enabled:false (2026-08-14 convention). The
  // server honors that flag deterministically, so this is not a voice path.
  if (/["']voice_enabled["']\s*:\s*false/.test(command)) return null;

  const channel = getNotificationChannel();
  logSkippedVoice({
    hookLabel: "VoiceEgressGuard",
    message: command.slice(0, 200),
    sessionId: input?.session_id,
  });
  return {
    block: true,
    message:
      `[VoiceEgressGuard] blocked voice call: this session's notification channel is '${channel}', not 'desktop'. ` +
      "Scheduled/headless sessions never voice-notify (principal directive, 2026-08-14). " +
      "Skip the announcement entirely and continue with the task — do not retry via another endpoint or flag.\n",
  };
}

// Standalone shim — runnable directly for testing, mirrors dispatcher behavior.
if (import.meta.main) {
  let input: any;
  try {
    input = JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    process.exit(0);
  }
  const result = check(input);
  if (result?.block) {
    process.stderr.write(result.message);
    process.exit(2);
  }
  process.exit(0);
}

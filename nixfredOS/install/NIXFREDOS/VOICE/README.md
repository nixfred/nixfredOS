# Voice

nixfredOS can speak. Voice is **optional**, **off by default**, and works on Linux and macOS. ElevenLabs gives the best quality but is never required: without it, voice falls back to what your OS already has.

One small module in Pulse does the speaking (`NIXFREDOS/PULSE/VoiceServer/voice.ts`). One CLI flips it on and off (`nixfredos-voice`). An optional listener lets you talk back.

## Quick start

```bash
nixfredos-voice on        # turn voice on
nixfredos-voice status    # shows ON/OFF, the engine in use, and Pulse health
nixfredos-voice test      # speaks a short test line
nixfredos-voice off       # silence, no exceptions
```

`nixfredos-voice` is linked into `~/.local/bin` by the Core deploy. If that directory is not on your `PATH`, add it to your shell profile, or call `~/.claude/NIXFREDOS/VOICE/bin/nixfredos-voice` directly.

## Engines and fallback order

With `"engine": "auto"` (the default) the first available engine wins:

| Order | Engine | Needs | Notes |
|-------|--------|-------|-------|
| 1 | `elevenlabs` | `ELEVENLABS_API_KEY` (env, `~/.claude/.env` or `~/.env`) and a voice id | Best quality. Paid, cloud. |
| 2 | `say` | macOS | Built in, zero install. |
| 3 | `piper` | `piper` on `PATH` and `piper_model` in `voice.json` | Local neural voice. |
| 4 | `espeak` | `espeak-ng` on `PATH` | Robotic, but available almost everywhere. |
| 5 | none | | The line is logged and nothing is spoken. |

Set `"engine"` to `elevenlabs`, `say`, `piper` or `espeak` to force one. A forced engine that is unavailable means silence, not a fallback.

Text is cleaned before it is spoken: code blocks, markdown, emoji and URLs are removed. An optional file, `NIXFREDOS/USER/PRINCIPAL/PRONUNCIATIONS.json`, maps an exact phrase to the text to speak instead: `{"nginx": "engine x"}`.

## Support matrix

| | Engines | Audio player |
|---|---|---|
| **Linux** | elevenlabs, piper, espeak (all) | `mpv` (recommended), then `ffplay`, then `paplay` (wav only) |
| **macOS** | elevenlabs, say (built in), piper, espeak | `afplay` (built in); `say` plays itself |

ElevenLabs and piper produce an audio file that needs a player. `say` and `espeak-ng` play on their own.

## The switch: `~/.claude/voice.json`

```json
{
  "enabled": false,
  "engine": "auto",
  "elevenlabs_voice_id": "",
  "elevenlabs_model": "eleven_turbo_v2_5",
  "say_voice": "",
  "piper_model": "",
  "volume": 1.0,
  "speaker": ""
}
```

Every key except `enabled` is optional.

- `enabled` is read on **every line**. Missing, unreadable or invalid file means **OFF** (fail closed). Only a literal `true` turns voice on.
- `NIXFREDOS_VOICE=off` in the environment forces OFF.
- Headless sessions (scheduled jobs) and subagents never speak, whatever the file says.
- `elevenlabs_voice_id` falls back to the assistant identity (`settings.json` `daidentity.voices.main.voiceId`).
- `speaker` names another machine. When set and different from this host, the line is sent there over `ssh` (text on stdin, key-based login only) and nothing plays locally. That machine needs nixfredOS and a working voice of its own.

## Endpoints (Pulse, 127.0.0.1:31337)

| Route | What it does |
|-------|--------------|
| `POST /notify` | `{message, title?, progress?, voice_id?, voice_enabled?}`. `progress: true` queues the line and returns at once; otherwise it returns after playback. `voice_enabled: false`, or switch OFF, answers `{"status":"off"}` and stays silent. |
| `POST /notify/personality` | Plain alias of `/notify`, kept for old callers. |
| `GET /speaking` | `{speaking, pending, last_end}`. Never rate limited; the listener polls it. |
| `GET /voice/health` | `{status, engine, enabled, platform}`. |

One serial queue: a line never overlaps another.

## CLI

```
nixfredos-voice on | off
nixfredos-voice status                exit 0 if ON, 1 if OFF
nixfredos-voice say [--bg] <message>  --bg queues and returns at once; --stdin reads the message from stdin
nixfredos-voice test
nixfredos-voice listen on|off|status  run the microphone listener as a background service
```

`listen` runs `NIXFREDOS/VOICE/talk/src/listen.ts` under `systemd --user` on Linux (unit `nixfredos-listen`, restarts on failure, low CPU priority) and under `launchd` on macOS (`com.nixfredos.listen`).

`nixfredos-voice words add|rm|list` teaches the listener words it mishears (see `talk/README.md`, "Words it gets wrong").

## How replies work

- **Completions.** When voice is ON, the assistant ends a response with one `🗣️` line and the Stop hook speaks it.
- **Spoken prompts.** A prompt that begins with `🎙️` was spoken to the listener. The prompt hook tells the assistant to answer aloud first with `nixfredos-voice say --bg`, in plain sentences, with details on screen. The Stop hook then skips that turn so nothing is said twice, and memory recall is skipped to keep the round trip short.
- **Guards.** Subagents and headless sessions are blocked from `nixfredos-voice say|test` and from the speaker endpoints.

## Security

- Pulse binds `127.0.0.1` only. Nothing on your network can reach the speaker.
- Every external program (`say`, `piper`, `espeak-ng`, `mpv`, `ffplay`, `afplay`, `ssh`) is started with an argument list, never a shell string, so spoken text cannot run as a command.
- Spoken text is passed after `--` or on stdin, so it can never be read as an option.
- The `speaker` host is validated against a strict hostname pattern before `ssh` is called.
- The switch fails closed: when in doubt, voice is OFF.
- Your ElevenLabs key is read from the environment or `.env` files and sent only to `api.elevenlabs.io`. It is never logged.

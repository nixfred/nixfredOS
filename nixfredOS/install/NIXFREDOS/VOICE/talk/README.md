# nixfredOS voice talk

Hands-free voice input for Claude Code. You say the assistant's name and a
request; the words are typed into the Claude session you are looking at as
`🎙️ <words>` + Enter. Hooks on the other side react to the 🎙️ prefix, and the
assistant answers out loud through the voice server.

Linux is the supported path. **macOS support is EXPERIMENTAL and untested.**

It does nothing unless `~/.claude/voice.json` says `"enabled": true` (fail
closed). It is normally run by `nixfredos-voice listen on|off|status`, which
starts `bun <install>/NIXFREDOS/VOICE/talk/src/listen.ts`.

## How it works

```
mic (30 ms frames, 16 kHz mono)
  -> echo guard      ignore the mic while the voice server speaks (GET /speaking)
  -> voice print     personal VAD: only audio that sounds like YOU becomes an utterance
  -> whisper-server  local speech-to-text (opening 2.5 s first, then the whole thing)
  -> wake word       the utterance must START with the assistant's name
  -> target          the Claude session you are looking at
  -> type            "🎙️ <words>" + Enter
```

- Everything runs locally. Room audio never leaves the machine; whisper-server
  binds 127.0.0.1.
- Without an enrolled voice print it falls back to an energy VAD: anyone who
  says the wake word gets through.
- Wake word: `voice.json` `"wake_word"`, else the assistant name in
  `settings.json` `daidentity.name`, else `Computer`. Matching is strict
  (name first, optionally after "hey/ok"). When the voice print has already
  confirmed it is you, a loose mode also accepts near-misses (edit distance of
  2 or less, names of 4+ characters) among the first 4 words.
- Spoken lines (errors like "Which session?") go to the voice server:
  `POST /notify`, default `http://127.0.0.1:31337` (override with `PULSE_URL`).
- Logs: `~/.local/state/nixfredos-voice/listen.log`; timings in `listen.jsonl`.

## Setup

```bash
cd NIXFREDOS/VOICE/talk
bun install
bun scripts/setup.ts        # downloads models, checks tools, prints what is missing. No sudo.
```

Models go to `~/.local/share/nixfredos-voice/models/` (whisper `ggml-base.en`,
and the speaker model). An existing whisper model in `/usr/share/whisper.cpp/models`
or similar is also found; `NIXFREDOS_WHISPER_MODEL` points at one explicitly.

**Linux**: `whisper-server` (whisper.cpp), `pw-record` + `pactl` (PipeWire),
`kitty` (`kitten`), optional Hyprland (`hyprctl`, finds the focused window) and
`herdr`. kitty needs remote control on a socket, e.g. in `kitty.conf`:

```
allow_remote_control socket-only
listen_on unix:/run/user/1000/kitty-{kitty_pid}
```

**macOS (EXPERIMENTAL, untested)**: `brew install whisper-cpp ffmpeg`, kitty with
the same two settings (socket under `/tmp`, e.g. `listen_on unix:/tmp/kitty-{kitty_pid}`).
The mic is `ffmpeg -f avfoundation -i ":0"` (`NIXFREDOS_MIC` picks another
device). The focused window is found by asking each kitty socket which OS
window `is_focused`; there is no hyprctl.

## Enroll your voice print

Stop the listener first so it does not hear the takes.

```bash
bun scripts/enroll.ts --record 5        # the voice server reads 5 lines, you repeat each
bun scripts/enroll.ts --from a.pcm ...  # or raw 16 kHz mono s16le takes
```

The print is a 192-number average stored at `~/.config/nixfredos-voice/voiceprint.json`
(mode 0600). It is biometric data: do not share or commit it. Threshold 0.35 is
provisional; the listener logs the scores it sees every 10 s so you can tune.

## Words it gets wrong

Speech-to-text mishears names and jargon ("Omarchy" comes out as "Amachi", "Hyprland" as "hyper land"). The listener fixes these **after** transcription, before the wake word check. It matches whole words only, ignores case, never touches anything inside a domain, path or hyphenated word, and prefers the longest match. Fixing it after transcription instead of with an initial prompt avoids whisper's prompt-induced loops.

- Built in: Omarchy, Hyprland, Waybar, common Linux tools (systemd, pacman, tmux, Btrfs, ...) and tech terms (GitHub, Claude Code, Kubernetes, Tailscale, ...).
- Your own: `nixfredos-voice words add <word> <heard as> [heard as ...]`, `words rm <word>`, `words list`. They are stored in `~/.config/nixfredos-voice/vocabulary.json` as `{"Word": ["heard as", ...]}`, and the listener reloads the file when it changes.
- Only add a "heard as" that is not an ordinary word. Whisper hears "herdr" as "herder", but people say herder, so that one stays out of the built-ins.

## Safety model

- **Wake word on every utterance.** No wake word, nothing is typed (TV and
  other people included).
- **Voice print before transcription.** Audio that does not sound like you is
  never sent to whisper.
- **Echo guard.** The mic is ignored while the voice server speaks and for 400 ms
  after, so the assistant does not hear itself.
- **Stale drop.** If your words took more than 10 s to get through whisper, they
  are not typed; you are asked to repeat.
- **Only into Claude.** A kitty window is typed into only if its foreground
  process is `claude`; a herdr pane only if its agent is `claude`. Never a bare shell.
- **herdr refuses blocked panes.** If the Claude is waiting on a question or
  approval, nothing is typed and you hear why.
- **"Which session?" instead of guessing.** With no focused Claude window the
  rule is: the only Claude window, else the last one used, else ask.
- **An ssh window that cannot be resolved types nothing.** If the focused
  window runs `ssh <host>` it never falls back to a local window.
- **Remote herdr is confirmed against the screen.** The window title can be stale
  and the server's global focus can belong to another client, so the candidates
  (the global focused pane and the title workspace's focused pane, Claude panes
  only) each have their recent output (`pane read --source recent --lines 30`)
  compared with this window's screen text (`kitten @ get-text`). Only a clear
  winner is used; a tie or no match types nothing.
- **The switch is re-read every 5 s.** Setting `"enabled": false` stops the mic.

## Remote herdr over ssh

When the focused window runs `ssh <host>` into a herdr session, the prompt is
sent with `herdr --machine <label> agent prompt <pane> ...`. This needs:

- a saved herdr machine profile for the host (`herdr machine ...`), enabled;
- on the remote, `window_title = "{hostname}: {workspace}"` in herdr's
  `config.toml`, so the title names the workspace.

## Tests

```bash
bun install
bun test src                 # pure unit tests: VAD, owner VAD, wake word, target, config
bunx tsc --noEmit            # type check (bun build does not type-check)
bun scripts/ears-test.ts     # optional: needs your own recordings in tests/fixtures/
                             # and whisper-server; prints SKIP and exits 0 otherwise
```

No audio fixtures ship (they would be a private voice). `listen.ts` starts the
mic at import, so tests only import the pure modules.

## Known limits

- **Dialogs on the kitty path can be answered by Enter.** Typing into a kitty
  window cannot see a question the Claude is showing; the Enter that submits
  your words can answer it. herdr panes are checked for "blocked"; kitty windows are not.
- **A TV as loud as you defeats the voice print.** It separates voices, not
  loudness; the wake word is the second gate, not a guarantee.
- **macOS is experimental.** Mic capture, focused-window detection and
  Homebrew paths are written but untested.
- Needs kitty remote control; other terminals are not supported.
- Speaker threshold and VAD numbers were tuned on one laptop; expect to retune.

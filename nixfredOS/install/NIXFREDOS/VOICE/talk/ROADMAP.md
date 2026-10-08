# Talk roadmap

Planned work, in order. Each item lists the problem and the design.

## 1. Answer where you spoke (multiple listeners)

**Problem.** You can run a listener on more than one machine, for example a laptop and a desktop. A session on the desktop can be reached from either one: by its own mic, or from the laptop through `ssh` + herdr. Today the answer plays wherever the session's host config points (`voice.json` `speaker`), which is not always where the user is sitting.

**Design.**
- The listener marks every spoken prompt with the host it heard the user on. It is a short, visible origin tag after the 🎙️ mark (for example `🎙️ laptop:`), so the user can see it too.
- The `PromptProcessing` spoken-turn rule reads the tag and tells the assistant to speak with `nixfredos-voice say --to <origin> --bg "..."`.
- `say --to <host>` plays locally when `<host>` is this machine, and otherwise forwards over ssh (text on stdin, as `speaker` does today).
- No tag means today's behavior.
- **Policy.** A host whose voice is otherwise off (silent agents) may still answer a prompt the user *spoke*, and only on the origin host. Completion lines, notifications and agent chatter stay silent.

## 2. Screen-confirm local herdr panes too

**Problem.** herdr's "focused pane" (`pane current`, and the snapshot's global `focused_pane_id`) follows whichever attached client acted last. If the user is attached from two places (locally and over ssh), the local listener can pick the pane focused in the *other* client.

**Design.** Reuse `pickByScreen()` for the local path:
1. Take two candidates: the global focus, and the focused pane of the workspace named in the window title.
2. Compare each candidate's recent output with the focused kitty window's screen text.
3. If neither clearly matches, type nothing.

## 3. A voice print per machine

**Problem.** A voice print enrolled on one mic scores lower on a different mic and room.

**Design.**
- `enroll.ts` records on the machine it runs on, and stores the voice print per host (`voiceprint.json` keyed by hostname, or one file per host).
- The listener uses its own host's print and falls back to any print it finds.
- Document picking a good mic (a USB dynamic mic beats a webcam mic) with `NIXFREDOS_VOICE_MIC_TARGET`.

## 4. Remote round-trip latency

**Problem.** A prompt typed into a session on another machine took over 30 s before the first spoken word. Local sessions take a few seconds.

**Plan.**
- Instrument each hop and record it in `listen.jsonl`: herdr submit, the remote session's time to first tool call, the ssh speak forward, and the speech queue.
- Likely levers: the remote session's model and context size; its per-prompt hooks (the spoken-turn path must skip expensive recall there too); ssh connection reuse.

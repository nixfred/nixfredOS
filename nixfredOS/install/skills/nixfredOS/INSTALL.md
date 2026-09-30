# Install nixfredOS

**The primary way to install nixfredOS is to give this document to your AI and say "install this."**

nixfredOS is AI-native, so the install is too. You hand this file (or its link) to whatever AI assistant you already use, and it does the whole install for you — on your OS, on your harness, with your permission at every step. You can also read it yourself and follow along; it's the same document either way.

---

## For you (the human) — 10 seconds

Paste this to your AI — Claude Code, Cursor, Cline, Codex, Gemini CLI, or any coding assistant that can read files and run commands:

> **Read https://github.com/nixfred/nixfredOS/blob/main/nixfredOS/INSTALL.md and install nixfredOS for me.**

That's the primary path. Your AI reads the rest of this page and installs nixfredOS for you.

Prefer a terminal? There's a shell shortcut for Claude Code on macOS/Linux:

```
curl -fsSL https://raw.githubusercontent.com/nixfred/nixfredOS/main/nixfredOS/install/install.sh | bash
```

Everything below is written for the AI doing the install.

---

## For the AI assistant — read this fully before you touch anything

You are installing nixfredOS for your human. The install is **additive**: you touch only nixfredOS's own files until they explicitly say yes to an integration step. Work through the phases in order. Before any change that modifies their machine, show exactly what will change and wait for a yes.

### 0. Capability gate — stop here if you fail it

You need to be able to (1) read and write files on this machine, and (2) run shell commands. If you cannot do both — for example you're a chat-only assistant with no filesystem or command execution — **stop now** and tell your human:

> "I can't install nixfredOS from here — I don't have file and command access on your machine. Run this from a coding harness like Claude Code, Cursor, Cline, Codex, or Gemini CLI, or use the terminal shortcut on the install page."

Do not begin a partial install you can't finish.

### 1. Prerequisites

Run the preflight first. It changes nothing, it only reports:

```
curl -fsSL https://raw.githubusercontent.com/nixfred/nixfredOS/main/nixfredOS/install/install.sh | bash -s -- --check
```

**Required**

| Need | Why | Get it |
|---|---|---|
| macOS 13+ or a modern Linux (Arch, Debian/Ubuntu, Fedora) | supported platforms | |
| `git`, `curl` | fetch the release, version your brain | macOS: `xcode-select --install` · Linux: your package manager |
| `bun` 1.2+ | runs the TypeScript tools and hooks | `curl -fsSL https://bun.sh/install \| bash` |
| `gh` (GitHub CLI) + a GitHub account | creates and backs up your **private** brain repo (step 8.7) | macOS: `brew install gh` · Arch: `sudo pacman -S github-cli` · Debian/Ubuntu: `sudo apt install gh` · Fedora: `sudo dnf install gh` |
| An AI coding harness | the engine nixfredOS drives | **Claude Code recommended** (paid plan); Cursor, Cline, Codex, Gemini CLI also work |

**Optional**

| Extra | What it adds |
|---|---|
| [Ollama](https://ollama.com) (native app, no Docker) | semantic, meaning-based memory recall. Apple Silicon or a GPU helps. |
| ElevenLabs API key | spoken responses (voice) |

**Never required:** Docker, a cloud account, telemetry. Nothing in nixfredOS runs in a container.

If bun is missing, install it and re-check: `curl -fsSL https://bun.sh/install | bash` (Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`).

### 2. Get the release and detect the environment

Fetch the pinned nixfredOS release for the repo and version on the install page (the tag tarball over HTTPS, no auth), or use a local release directory if given one. Then, from the nixfredOS skill directory, run:

```
bun Tools/DetectEnv.ts
```

Read its output. It reports the OS (macOS / Linux / Windows), the harness (Claude Code / Cursor / Cline / Codex / Gemini / other), the config root, and whether nixfredOS is already present. **Every path below comes from this — don't assume `~/.claude` or any single harness.**

### 3. Scan for conflicts (read-only)

```
bun Tools/ScanConflicts.ts
```

Surfaces anything already sitting in the target directories. Show your human. Nothing has changed yet.

### 4. Drop the skill and runtime (additive)

```
bun Tools/DeployCore.ts            # dry run — prints the plan, writes nothing
bun Tools/DeployCore.ts --apply    # performs the copy
```

Copies the nixfredOS skill and runtime into the harness's config tree. Existing files are never overwritten — only missing ones are added.

**These tools are dry-run by default.** Without `--apply` they print a plan and change nothing, so an install that omits the flag reports success while copying zero files. Run the dry run first, show your human, then re-run with `--apply`.

### 5. Scaffold the personal (USER) tree

```
bun Tools/ScaffoldUser.ts --apply
bun Tools/LinkUser.ts --apply
```

Both are dry-run without `--apply`, same as the previous step. Creates the personal config tree from templates and links it in. This is empty structure — no personal content yet. That comes in the interview.

### 6. Wire the integration — HARNESS-SPECIFIC, WITH PERMISSION

This is the one place harnesses genuinely differ. Show the exact change and get a yes.

- **Claude Code** — run `bun Tools/InstallHooks.ts --apply` (merges the hook set into `settings.json`, backing it up first) and `bun Tools/ActivateImports.ts --apply` (turns on the identity context imports). **Both need `--apply`** — without it they print a plan and write nothing. This is what lights up the always-on behavior: the nixfredOS response format, the memory loop, and per-turn context injection.

- **Any other harness (Cursor / Cline / Codex / Gemini / other)** — nixfredOS's always-on behavior is enforced by Claude Code *hooks*, which are a Claude Code mechanism. They don't auto-wire on other harnesses **yet**. So instead:
  1. Write an `AGENTS.md` (or the harness's own context file — e.g. `.cursor/rules`) that points the harness at the nixfredOS tree, so it loads the nixfredOS context every session.
  2. Tell your human, plainly and honestly: *"On <harness>, the always-on hooks aren't wired yet. You get the skill, your USER data, Pulse, and context loading every session, and you run Setup and Interview on request. Full always-on behavior is on the roadmap for this harness."*
  3. **Do not** write Claude hook files or a Claude `settings.json` `hooks` block into a non-Claude harness — it would sit there inert and do nothing.

### 7. Wire the launch command — HOW nixfredOS actually turns on (WITH PERMISSION)

This is the step that makes nixfredOS *load*. The constitutional layer — the response format, verification doctrine, security protocol, the whole operating contract — lives in `install/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md` and is **NOT** loaded by a plain `claude` session. It loads only when the harness is launched with that file appended to its system prompt. So installed nixfredOS needs its own launch command; running vanilla `claude` gives you CLAUDE.md but **not** the constitution.

The payload ships the launcher — `install/NIXFREDOS/TOOLS/nixfredos.ts` — which spawns Claude with `--append-system-prompt-file <configRoot>/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md` (plus the banner and MCP-profile handling). Wire a `nixfredos` command that calls it into your human's shell. **Show the exact line, back up the rc file first, wait for a yes.** Use the real `<configRoot>` from `DetectEnv` (e.g. `~/.claude`) — never hardcode a home path.

- **Claude Code (zsh / bash)** — append to `~/.zshrc` (or `~/.bashrc`):
  ```
  alias nixfredos='bun <configRoot>/NIXFREDOS/TOOLS/nixfredos.ts -s <configRoot>/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md'
  ```
  fish: `alias nixfredos "bun <configRoot>/NIXFREDOS/TOOLS/nixfredos.ts -s <configRoot>/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md"; funcsave nixfredos`. After this, **`nixfredos` launches Claude WITH the constitution**; plain `claude` stays vanilla (which is fine — the user opts in by launching `nixfredos`).

  **Upgrade path — migrate stale pre-7.x aliases.** Pre-7.x installs wired a `pai` launch alias (`cd ~/.claude && claude`, or `bun ~/.claude/PAI/ACTIONS/pai.ts`). The `PAI/` tree no longer exists and the bare-`claude` form launches without the constitution, so check the rc for these, and (with permission, rc backed up) comment them out and repoint the SAME alias name at the launcher above — the human's muscle-memory `pai` keeps working. `install.sh` does this automatically at bootstrap; do it here when the human ran setup without the bootstrap script. Never touch an alias containing `NIXFREDOS_SYSTEM_PROMPT` (current) or `ARBOL/Actions/nixfredos.ts` (the maintainer-side Arbol CLI alias — that tree does not ship in the public payload, so if the string appears in an rc, leave it alone).

- **Any other harness** — use that harness's own system-prompt flag against the same file. e.g. pi: `pi --append-system-prompt <configRoot>/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md`. If a harness has no system-prompt flag, load `NIXFREDOS_SYSTEM_PROMPT.md` through its context file (AGENTS.md / rules) as the closest equivalent, and tell your human plainly that the constitution is loading as context, not as a true system-prompt layer.

If your human declines the shell edit, give them the one-line launch command to run by hand so the constitution still loads:
```
bun <configRoot>/NIXFREDOS/TOOLS/nixfredos.ts -s <configRoot>/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md
```

### 8. Choose the components — install all, or pick a subset (WITH PERMISSION)

nixfredOS installs in **two layers**, and you present them that way.

**Core** (steps 4–7, always together) IS nixfredOS: the skill + the full **skill library** + the NIXFREDOS runtime (Algorithm, docs, tools, statusline binary, version) + the USER tree + the system prompt and its `nixfredos` launch command. One consent installs all of Core; declining means not installing nixfredOS.

**Enhancements** are **à la carte** — offer them and let your human pick some, all, or none. Each is independently installed, idempotent, and reversible:

| Component | What it adds | Default |
|---|---|---|
| **hooks** | skill routing, the memory loop, voice, per-turn context injection — most behavior needs these (this is step 6) | **recommended** |
| **statusline** | the nixfredOS status line in your prompt — set `preferences.temperatureUnit` in `settings.json` to match your human's locale (payload default is `celsius`; suggest `fahrenheit` for US locales/timezones) | optional |
| **tooltips** | custom Claude Code spinner tips | optional |
| **spinner verbs** | custom spinner verbs | optional |
| **agents** | the named agent library | optional |
| **Pulse** | the Life Dashboard — menu-bar app + `launchd` service on `:31337` | optional |
| **worksweep / derivedsync** | background `launchd` jobs (work capture, derived-file sync) | optional |

Pulse, worksweep, and derivedsync install as **launchd** agents on macOS and as **systemd --user** units on Linux — their installers dispatch on platform, so offer them on both (Windows has neither: skip cleanly there). The macOS menu-bar app is genuinely macOS-only. Show your human this menu, take their picks, and deploy only those. The **Setup** workflow (step 9) drives the actual deployment of the chosen set and verifies each with real evidence (e.g. Pulse → `curl :31337/healthz` = 200). Everything ships in the payload; nothing activates without its matching yes.

### 8.5 Capability check — probe what doctrine assumes (Doctor)

nixfredOS doctrine leans on a few **external tools** the core install does not ship: a cross-vendor audit CLI (`codex`), a real browser for web verification (Interceptor), Cloudflare/wrangler for scheduled cloud flows, ElevenLabs for voice. Nothing above installed them, and the features that depend on them must degrade *loudly*, not silently. After Core lands, run the doctor:

```
bun <configRoot>/NIXFREDOS/TOOLS/Doctor.ts
```

It prints one line per capability — live ✅, broken ❌ (each with its own copy-paste fix command), or off ⏸ — and writes an advisory manifest the runtime uses to flag degraded output. Then ask your human, per broken capability: **set it up now, later, or never?**

- **Now** → run the fix command shown, re-run Doctor. With their permission, add `--network` to verify auth end-to-end — network probes only ever touch capabilities they have already configured.
- **Later** → leave it. The runtime will surface it the moment a degraded capability is actually invoked, fix command included.
- **Never** → `bun <configRoot>/NIXFREDOS/TOOLS/Doctor.ts decline <name>`. Declined is a clean, permanent, silent OFF — no warnings, no red marks, no nagging, ever. Declining is a legitimate way to run nixfredOS, not a defect.

Deeper walkthroughs per tool (what it's for, install, auth, verify it's live): `GETTING-STARTED.md`, shipped next to this file. Your human can re-run the doctor any time something feels off: `nixfredos doctor` territory — it's the same command.

### 8.6 The memory engine — your AI remembers (WITH PERMISSION)

nixfredOS ships Larry's memory engine (LMF4.1) **with an empty memory**. Nothing about anyone else comes with it; your assistant builds its own memory about your human, on their disk.

What it adds: `~/.claude/memory.db` (SQLite + FTS5), 7 hooks (SessionExtract, AssociativeRecall, RememberTrigger, MagnitudeCapture, PreCompact, PostCompact, StopFailure), the `mem` CLI, the `nixfredos-memory` MCP server, `~/.claude/MEMORY/AUTO/` seeded with 3 obviously fake examples, and 4-hour catch-up/backup timers (launchd on macOS, systemd on Linux). No Docker.

Show your human that list, then with a yes:

```
cd <skillRoot>/install/memory-engine && ./install
mem search "test"          # should answer "No results found." on a fresh install
```

Then offer the optional semantic layer **only if Ollama is present** (`command -v ollama`): `ollama pull nomic-embed-text && mem embed backfill`. Without Ollama, keyword recall works fine; say so and move on.

Teach your human the one habit that matters: saying **"remember X"** makes you write a memory file that same turn. Details: `install/memory-engine/README.md` and `install/memory-engine/docs/LRMS.md`.

### 8.7 The private brain repo — GitHub backup of `~/.claude` (WITH PERMISSION)

Your human's memory, settings and history must be backed up to a **PRIVATE** GitHub repo. Walk them through it; never skip the privacy checks.

1. **gh present?** `gh --version`. If missing, install it (show the command, wait for a yes):
   - macOS: `brew install gh` (if Homebrew is missing, send them to https://brew.sh first)
   - Arch: `sudo pacman -S github-cli` · Debian/Ubuntu: `sudo apt install gh` · Fedora: `sudo dnf install gh`
2. **Log in — the human types, not you.** Ask them to run `gh auth login` themselves (in Claude Code: `! gh auth login`), choosing GitHub.com, HTTPS, and browser login. Confirm with `gh auth status`. Never ask for, paste, or store a token yourself.
3. **Pick a name.** Suggest `<assistant-name>-brain` (for example `nova-brain`). Get their GitHub login with `gh api user -q .login`.
4. **Create it PRIVATE:** `gh repo create <login>/<name>-brain --private --description "Private AI brain backup"`.
5. **Verify before any push.** Run `gh repo view <login>/<name>-brain --json visibility -q .visibility`. It MUST print `PRIVATE`. If it prints anything else, **stop**, tell your human, and do not push.
6. **Protect secrets first.** In `~/.claude`, create `.gitignore` with at least: `.env`, `*.key`, `*.pem`, `credentials*`, `secrets/`, `.credentials.json`, `node_modules/`, `*.log`. Show it to your human.
7. **First commit:**
   ```
   cd ~/.claude && git init -b main   # skip if already a repo
   git remote add origin https://github.com/<login>/<name>-brain.git
   git remote -v                      # read the URL out loud to your human
   git add -A && git status --short   # show what will be committed; scan for secrets
   git commit -m "init: <name> brain"
   gh repo view <login>/<name>-brain --json visibility -q .visibility   # re-check: PRIVATE
   git push -u origin main
   ```
8. Point the memory engine's backup at it too, if they want session transcripts backed up: `cd ~/.claude/conversations-backup && git remote add origin <another private repo URL>` (same PRIVATE check first).

**Hard rule:** never push `~/.claude` (or any memory) to a repo whose visibility is not `PRIVATE`. Re-check visibility before every first push to a new remote.

### 9. Run Setup, then Interview

Run the **Setup** workflow (`Workflows/Setup.md`) to finish integration and verify with real evidence, then the **Interview** workflow (`Workflows/Interview.md`): name the assistant, capture identity and TELOS (current state → ideal state), pull in any sources your human offers, and seed Pulse. By the end, the config tree is populated and Pulse shows real data.

---

## What you get on each setup (be honest about this)

| Harness / OS | Skill + USER data + Pulse | Always-on behavior (response format, memory loop, context injection) |
|---|---|---|
| **Claude Code — macOS / Linux** | ✅ | ✅ full (native hooks) |
| **Claude Code — Windows** | ✅ (USER tree links as a directory junction — no admin needed) | ✅ full |
| **Cursor / Cline / Codex / Gemini / other** | ✅ | ⚠️ context loads every session via `AGENTS.md`; workflows run on request; always-on hooks not wired yet (roadmap) |
| **Chat-only assistants (no files / no commands)** | ❌ | ❌ — install stops at the capability gate |

Full-doctrine features additionally depend on the external tools in step 8.5 (codex, browser, Cloudflare, ElevenLabs). Without one, the dependent feature runs degraded **and says so** — it never silently pretends. The Doctor table is the live source of truth for what's on.

## Rules you must follow

- **Additive, never clobbering.** Only add what's missing; never overwrite or delete a populated dir or a file you didn't create.
- **Permission before every mutation.** Show the exact change; back up `settings.json` before editing it; wait for a yes. One documented exception: the `install.sh` bootstrap, by invocation, migrates stale pre-7.x launch aliases (rc backed up first; skip with `NIXFREDOS_SKIP_ALIAS=1`) and appends capture rules to the config-root `.gitignore` — running the bootstrap is the consent for those two bounded setup mutations. AI-led setup steps after the bootstrap always ask.
- **Never write a harness's config that it won't read.** Honest degrade beats an inert install.
- **The launch command loads the constitution — don't skip it.** A plain `claude` session gets CLAUDE.md but not `NIXFREDOS_SYSTEM_PROMPT.md`. The `nixfredos` command (step 7), or the harness's system-prompt flag, is what turns the operating contract on. Wire it, or the install is missing its whole constitutional layer.
- **Memory goes to PRIVATE repos only.** Verify `gh repo view <repo> --json visibility` prints `PRIVATE` before the first push of `~/.claude` or any memory. Anything else: stop and tell your human.
- **Refuse to run inside the nixfredOS source repo** (detected via source-repo markers). Never mutate a maintainer's live system.

---
name: nixfredOS
version: 1.5.43
description: Install and onboard a user into nixfredOS — the Life Operating System (current state → ideal state via TELOS + the Algorithm). The agentic installer detects your OS + harness, wires hooks with permission, scaffolds your USER tree, pulls in sources you provide, and runs the TELOS / current→ideal interview that seeds your Pulse dashboard. USE WHEN install nixfredOS, set up nixfredOS, nixfredos setup, nixfredos-setup, nixfredos interview, onboard me, run the interview, integrate nixfredOS into my harness, update nixfredOS, uninstall nixfredOS, first-time setup, nixfredos doctor, check my install, what capabilities are broken. NOT FOR building or cutting a nixfredOS release (private release tooling), editing TELOS after onboarding (use Telos / Interview), or nixfredOS system maintenance (use the private maintenance skill).
disable-model-invocation: true
argument-hint: "[setup|interview|doctor|update|uninstall]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# nixfredOS

> **This is the INSTALLED copy of the nixfredOS skill, not the distribution root.**
> Its `install/` directory holds only bootstrap files; the whole-system payload lived in the
> release artifact you installed FROM and is now deployed across `~/.claude`. Statements below
> about the skill being self-contained describe that release artifact, not this directory.
> Run the setup and deploy tools from `~/.claude`, not from here — relative paths do not
> resolve in this copy.


The install + onboarding surface for **nixfredOS** — the Life Operating System. One command takes a stranger on any harness from nothing to a working, personalized install whose Pulse dashboard already shows their current state vs ideal state — without making them adopt a whole new harness.

## How it ships

nixfredOS is distributed as **one self-contained skill** — the `nixfredOS/` directory is the *entire* distribution. Everything ships inside it: the orchestrator (`SKILL.md`, `Workflows/`, `Tools/`), the whole-system payload under `install/`, and the one-line bootstrap at `install/install.sh`. **Nothing ships outside the skill** — no release-root `install.sh`, no `.claude/` clone.

**The primary install is AI-native: give `INSTALL.md` (at `github.com/nixfred/nixfredOS/blob/main/nixfredOS/INSTALL.md`) to your AI and say "install this."** nixfredOS is AI-native, so the install is too — you hand the doc (or its link) to whatever harness you already use, and your AI installs nixfredOS on your OS and harness, with permission at each step. It's the same document a human can read and follow. `INSTALL.md` opens with a capability gate, drives the install Tools (which run under `bun` on any OS, not a shell), wires integration per-harness (honest about what each gets), then runs Setup → Interview.

A terminal shortcut stays for Claude Code on macOS/Linux:

```
curl -fsSL https://raw.githubusercontent.com/nixfred/nixfredOS/main/nixfredOS/install/install.sh | bash
```

Both are served from the skill's own single sources of truth — `INSTALL.md` at the skill root, `install/install.sh` for the shell path (which hands off to the agentic `/nixfredOS setup`). Two versions coexist and mean different things: the frontmatter `version:` is this skill's own **component** line (bumped by the maintainer-side `BumpSkillVersions`, which does not ship in the release), while the **distribution** version — what a user means by "nixfredOS 7.x" — is the GitHub release tag and the `NIXFREDOS_RELEASES/<version>/` parent dir. Never read the component line as the release number. The payload (skills, hooks, system prompt, Algorithm, docs, runtime tools) rides along under `install/` and is placed during setup, with permission.

## Workflow Routing

| Trigger | Target |
|---------|--------|
| `setup`, `/nixfredOS setup`, "install nixfredOS", "integrate into my harness" | `Workflows/Setup.md` |
| `interview`, "onboard me", "run the interview", TELOS capture | `Workflows/Interview.md` |
| `doctor`, "check my install", "what's broken", "what capabilities are live" | run `bun <configRoot>/NIXFREDOS/TOOLS/Doctor.ts` (see `INSTALL.md`) |
| `update`, "update nixfredOS", after a version bump | `Workflows/Update.md` |
| `uninstall`, "remove nixfredOS" | `Workflows/Uninstall.md` |

`doctor` is the one tool-backed route — it needs no workflow because `Doctor.ts` is self-describing: it prints the four capability states (live / broken / declined / stale) and the exact fix command for anything broken. Relay its table, offer the fix it names, and honor `decline` — a declined capability is a legitimate way to run nixfredOS, never a defect to nag about.

Default flow (`/nixfredOS setup`): **Setup phase** (system integration) → transitions into **Interview phase** (life onboarding). One continuous experience, two clearly-marked phases — setup is logistics, interview is meaning. Setup ALWAYS runs first; hooks must be wired before the interview seeds anything.

## The two phases

**Setup (logistics, first).** Detect OS + harness → scan for conflicts and surface them → install prerequisites → overlay the system templates → scaffold the USER tree + link it → **trust-gated hook install** (show the exact change, back up `settings.json`, wait for yes) → activate the identity imports → verify with two evidence classes. Adapts to OS (macOS/Linux/Windows) and harness (Claude Code / Hermes / Cursor / OpenClaw).

**Interview (meaning, second).** Name the DA → principal identity → TELOS current state → TELOS ideal state → **pull in external sources the user provides** (existing notes, configs, exports) to enrich USER context → seed Pulse. By the end, the config tree is populated and Pulse shows real data, not empty scaffolding.

## Hard rules

- **Setup before Interview, always.** Hooks/integration land before any onboarding write.
- **Additive, never clobbering.** `install.sh` touches only the nixfredOS skill dir; setup writes are `existsSync`-guarded. Never overwrite or `rm` a populated dir or a foreign file.
- **Permission before mutation.** Hook install shows the exact change (file count + settings entries) and backs up `settings.json` first. Nothing changes without an explicit yes.
- **Config root keeps its canonical name.** The user tree lives under the config dir and is linked into the harness tree; "nixfredOS" is the brand, the resolved config path does not rename (renaming it breaks the identity `@`-imports).
- **Dev-tree refusal.** The hook install refuses to run inside the nixfredOS source repo (detected via dev-tree markers — the private maintenance skill present, or a recognized source-repo git remote). Never mutate the author's live system.

## Gotchas

- **The frontmatter `version:` is the COMPONENT line, not the release.** Claude Code ignores it; the maintainer-side `BumpSkillVersions` (not shipped) maintains it at the source repo. The DISTRIBUTION version is the tag + `NIXFREDOS_RELEASES/<version>/` + the `install.sh` fetch.
- **`install.sh` is non-destructive by design.** It installs only the nixfredOS skill and backs up only a prior nixfredOS skill — never the user's other skills, hooks, or config. The whole point is "bolt on, don't take over."
- **Hooks are installed imperatively, with permission.** A bare skill cannot auto-wire hooks; the setup workflow writes them into the user's harness explicitly, after showing what changes.
- **Config is `.toml`, never `.yaml`.** `nixfredOSConfig.ts` reads TOML; the legacy `.yaml` template was retired 2026-06-19.
- **Cross-platform is solved at setup time, not statically.** The setup conversation detects the OS + harness and tailors hook commands and paths — don't assume macOS.

## Examples

- "install nixfredOS" → `install.sh` drops the skill, then `/nixfredOS setup` runs: detect env, surface conflicts, wire hooks with permission, scaffold the USER tree, then roll into the interview.
- "run the nixfredos interview" → Interview workflow: capture TELOS + current/ideal state, pull in the user's sources, seed Pulse.
- "nixfredos doctor" → run `Doctor.ts`, relay the capability table, offer the fix command for anything broken.
- "update nixfredOS" → Update workflow: idempotent re-overlay after a version bump, non-destructive.

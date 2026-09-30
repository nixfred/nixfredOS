# nixfredOS memory engine

Persistent memory for your AI, built on **LMF4.1** (the Larry Memory Framework). It ships **empty**: your assistant builds its own memory about you, on your disk, backed up to your own private GitHub repo.

- **No Docker. No cloud. No telemetry.** SQLite + FTS5 in `~/.claude/memory.db`.
- **macOS 13+ and Linux.** Timers use launchd on macOS and systemd on Linux.
- **Semantic recall is optional.** If Ollama is installed, `ollama pull nomic-embed-text && mem embed backfill` adds meaning-based search. Keyword search works without it.

## What it installs

| Piece | What it does |
|---|---|
| `memory.db` | Sessions, decisions, errors and learnings, full-text indexed |
| `SessionExtract` hook | When a session ends, extracts what mattered into memory.db |
| `AssociativeRecall` hook | On every prompt, finds related memories and injects them |
| `RememberTrigger` hook | "remember X" writes a memory file that same turn |
| `MagnitudeCapture` hook | Big facts (decisions, standing rules, launches) get saved unasked |
| `PreCompact` / `PostCompact` | Saves context before the harness compacts the conversation |
| `StopFailure` hook | Records failures so the same mistake is not repeated |
| `mem` CLI | `mem search "query"`, `mem catchup`, `mem embed backfill` |
| MCP server `nixfredos-memory` | `memory_search` and `memory_recall` tools inside a session |
| `MEMORY/AUTO/` | One fact per file, plus a `MEMORY.md` index (seeded with 3 fake examples) |
| Timers | Catch-up extraction and backup every 4 hours |

## Install

The main nixfredOS install guide (`nixfredOS/INSTALL.md`) runs this for you. To run it by hand:

```bash
cd nixfredOS/install/memory-engine && ./install
```

It is idempotent: safe to run again to upgrade.

## Learn more

- [`docs/LRMS.md`](docs/LRMS.md): git commit trailers as searchable memory
- [`docs/for-the-human/`](docs/for-the-human/): daily use, searching, backups
- [`docs/for-the-ai/`](docs/for-the-ai/): how the assistant should use its memory

LMF4.1 is MIT licensed: https://github.com/nixfred/lmf4.1

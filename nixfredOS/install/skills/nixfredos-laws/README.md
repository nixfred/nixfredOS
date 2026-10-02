# nixfredos-laws

A Claude Code mod. It runs inside Claude Code as TypeScript function hooks, so
it sees every Bash call before and after it runs, with no process spawned per
call. It does two jobs and stays out of the way the rest of the time.

Needs Claude Code 2.1.287 or newer with mods enabled for your account. Run
`claude plugin test <this folder>`: if mods are not on yet it says so.

## What it does

**Three strikes.** It counts the Bash calls that fail in one turn. On the third,
a note the model reads (and you do not see) rides along with the failed result:
stop guessing, say what was tried, research the exact error. The count resets on
your next prompt.

**Remote readout.** Before any `git commit` or `git push` runs, it reads
`git remote -v` in the directory the command targets, finds the push URL, and for
a GitHub remote asks `gh` whether the repo is public or private (once per repo
per session). A push to a remote on the never-push list is refused before git
runs.

**The band.** A row above the prompt appears only when one of those has
something to say:

- `✗✗ 2/3 failed` in yellow, then `✗✗✗ 3/3 failed, stop and research` in red
  with a `research` button that queues a prompt telling the model to do exactly
  that.
- `push → origin you/project · PUBLIC, read the diff for secrets first` in
  yellow, `private` in green, `visibility unknown` in cyan, the never-push list
  in red.
- A `hide` button puts the band away until your next prompt.

Buttons take a click in the fullscreen terminal, or ctrl+x then tab to focus the
band.

## Make it yours

Everything you would change is at the top of `hooks/laws.ts`:

| Name | What it sets |
|---|---|
| `STRIKES` | failed Bash calls in a turn before the note (default 3) |
| `NEVER_PUSH` | push URL patterns that are refused outright (default: a remote whose push URL is `DISABLED`) |
| `TRIPWIRES` | commands refused before they run, each with the reason the model reads (default: none) |

To neuter a remote so the mod (and git itself) will not push to it:

```bash
git remote set-url --push upstream DISABLED
```

A tripwire is one line. When a command burns you twice, add it:

```ts
[/\bgit\s+push\b[^|;&]*--force\b/, 'No force pushes here. Use --force-with-lease, and only when asked.'],
```

After any edit:

```bash
claude plugin validate ~/.claude/skills/nixfredos-laws
claude plugin test ~/.claude/skills/nixfredos-laws
```

## Install

nixfredOS setup copies this folder to `~/.claude/skills/nixfredos-laws`, and
Claude Code loads it at the start of every session as
`nixfredos-laws@skills-dir`. To try it without installing:

```bash
claude --plugin-dir /path/to/nixfredos-laws
```

To remove it, delete the folder.

## What it can reach

A mod runs with the same access to your machine as Claude Code itself. This one
runs two commands, `git remote -v` and `gh repo view <owner/repo> --json
visibility`, reads `HOME`, and writes nothing to disk. `claude plugin validate`
prints the full list of what it hooks and calls.

## Limits

- It reads the first `git commit` or `git push` in a command line. A push
  buried in a script it cannot see is not read.
- Visibility needs the `gh` CLI, signed in. Without it every GitHub remote
  shows as unknown.
- A failed Bash call is whatever Claude Code reports as an error, which includes
  a search that matched nothing. The note says so, and leaves the call to the
  model.

import type { Privacy } from '../types'

// ─── Yours to edit ───────────────────────────────────────────────────────────

/** Bash calls that fail in one turn before the model is told to stop and research. */
export const STRIKES = 3

/** A push to a remote whose push URL matches any of these is refused outright. */
export const NEVER_PUSH: readonly RegExp[] = [
  /DISABLED/, // the usual way to neuter a remote: git remote set-url --push upstream DISABLED
  // /github\.com[:/]someone-else\//,
]

/**
 * Tripwires: commands that already burned you once. Each is a pattern and the
 * reason the model reads when its command is refused. Empty by default.
 */
export const TRIPWIRES: ReadonlyArray<readonly [RegExp, string]> = [
  // [/\bgit\s+push\b[^|;&]*--force\b/, 'No force pushes here. Use --force-with-lease, and only when asked.'],
]

// ─────────────────────────────────────────────────────────────────────────────

export function tripwire(command: string): string | undefined {
  return TRIPWIRES.find(([re]) => re.test(command))?.[1]
}

export type GitIntent = { verb: 'commit' | 'push'; dir?: string; remote?: string }

const WORD = `("[^"]+"|'[^']+'|\\S+)`
const GIT = new RegExp(
  `(?:\\bcd\\s+${WORD}\\s*&&\\s*)?\\bgit\\b((?:\\s+-[cC]\\s+${WORD}|\\s+--[\\w-]+(?:=\\S+)?)*)\\s+(commit|push)\\b([^|;&\\n]*)`,
)

const unquote = (word: string) => word.replace(/^(["'])(.*)\1$/, '$2')

/** The first `git commit` or `git push` in a command: its directory and, for a push, its remote. */
export function gitIntent(command: string): GitIntent | undefined {
  const found = GIT.exec(command)

  if (found === null) {
    return undefined
  }

  const cd = found[1]
  const flags = found[2] ?? ''
  const rest = found[5] ?? ''
  const dashC = new RegExp(`\\s-C\\s+${WORD}`).exec(flags)?.[1]
  const dir = dashC ?? cd
  const intent: GitIntent = { verb: found[4] === 'push' ? 'push' : 'commit' }

  if (dir !== undefined) {
    intent.dir = unquote(dir)
  }

  if (intent.verb === 'push') {
    const remote = rest.split(/\s+/).find(word => word !== '' && !word.startsWith('-'))

    if (remote !== undefined) {
      intent.remote = remote
    }
  }

  return intent
}

/** `git remote -v` output as name -> push URL. */
export function parseRemotes(stdout: string): Record<string, string> {
  const remotes: Record<string, string> = {}

  for (const line of stdout.split('\n')) {
    const found = /^(\S+)\s+(\S+)\s+\(push\)$/.exec(line.trim())

    if (found?.[1] !== undefined && found[2] !== undefined) {
      remotes[found[1]] = found[2]
    }
  }

  return remotes
}

/** `owner/repo` for a GitHub URL, or undefined for anything else. */
export function githubSlug(url: string): string | undefined {
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1]
}

/** Where a push URL sits: never, public, private, or unknown. `visibility` is what `gh` said, if anything. */
export function classify(url: string, visibility: string): { privacy: Privacy; label: string } {
  if (url === '') {
    return { privacy: 'none', label: 'no such remote' }
  }

  if (NEVER_PUSH.some(re => re.test(url))) {
    return { privacy: 'never', label: 'on the never-push list' }
  }

  if (visibility === 'PUBLIC') {
    return { privacy: 'public', label: 'PUBLIC, read the diff for secrets first' }
  }

  if (visibility === 'PRIVATE' || visibility === 'INTERNAL') {
    return { privacy: 'private', label: 'private' }
  }

  return { privacy: 'unknown', label: 'visibility unknown, check before pushing' }
}

export const short = (url: string) =>
  url.replace(/^(?:https?:\/\/|git@)/, '').replace(/^github\.com[:/]/, '').replace(/\.git$/, '')

export const strikeNote = (failures: number) =>
  `nixfredos-laws: that is failed Bash call #${failures} this turn. If these are the same problem, stop guessing: say what was tried and why each attempt failed, then research the exact error before another variant. If they are unrelated (a search with no match, an expected non-zero exit), carry on.`

export const RESEARCH_PROMPT =
  'Stop trying variants. List what you tried and why each attempt failed, then research the exact error and come back with the fix that the evidence supports.'

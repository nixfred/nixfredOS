// Pure helpers for finding which session the user is looking at. No I/O, so
// tests can import them (listen.ts starts the mic at import time).

// `ssh [opts] dest [cmd]`: the destination is the first non-option argument.
const SSH_VALUE_OPTS = new Set('BbcDEeFIiJLlmOoPpQRSWw'.split(''))
export function sshDestination(argv: string[]): string | null {
  if (!/(^|\/)ssh$/.test(argv[0] ?? '')) return null
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('-')) { if (a.length === 2 && SSH_VALUE_OPTS.has(a[1])) i++; continue }
    return a.split('@').pop()!
  }
  return null
}

// herdr sets the outer terminal title from config.toml `window_title`. The
// remote herdr must use "{hostname}: {workspace}". Returns the workspace label,
// or null.
export function workspaceFromTitle(title: string): string | null {
  const m = /^[^:\s]+:\s+(.+)$/.exec(title.trim())
  return m ? m[1].trim() : null
}

export interface PanePick { pane_id: string; agent: string | null; agent_status: string | null }

// A herdr server can have several clients and ONE global focused pane, which
// may belong to another client (the global focus can sit in one workspace while
// your ssh window shows another). So: workspace by label -> its active tab ->
// that tab layout's focused pane. An unknown or ambiguous label is an error,
// never a guess.
export function pickHerdrPane(snapshot: any, workspaceLabel: string): PanePick | { error: string } {
  const ws = (snapshot.workspaces ?? []).filter((w: any) => w.label === workspaceLabel)
  if (ws.length !== 1) return { error: `${ws.length} workspaces labelled "${workspaceLabel}"` }
  const layout = (snapshot.layouts ?? []).find((l: any) => l.tab_id === ws[0].active_tab_id)
  if (!layout) return { error: `no layout for tab ${ws[0].active_tab_id}` }
  const pane = (snapshot.panes ?? []).find((p: any) => p.pane_id === layout.focused_pane_id)
  if (!pane) return { error: `focused pane ${layout.focused_pane_id} not found` }
  return { pane_id: pane.pane_id, agent: pane.agent ?? null, agent_status: pane.agent_status ?? null }
}

/**
 * The herdr panes the user may be looking at, Claude panes only: the server's
 * global focused pane, and the focused pane of the workspace named in the window
 * title. Either can be wrong when several clients are attached (locally and
 * over ssh), so the caller confirms them against the screen (pickByScreen).
 */
export function herdrCandidates(snapshot: any, title: string): Array<{ pane_id: string; agent_status: string | null }> {
  const claudePane = (id: string | undefined) => (snapshot?.panes ?? []).find((p: any) => p.pane_id === id && p.agent === 'claude')
  const cands = new Map<string, { pane_id: string; agent_status: string | null }>()
  const add = (p: any) => { if (p) cands.set(p.pane_id, { pane_id: p.pane_id, agent_status: p.agent_status ?? null }) }
  add(claudePane(snapshot?.focused_pane_id))
  const label = workspaceFromTitle(title)
  if (label) {
    const pick = pickHerdrPane(snapshot ?? {}, label)
    if (!('error' in pick)) add(claudePane(pick.pane_id))
  }
  return [...cands.values()]
}

/**
 * The kitty socket that belongs to a kitty process: `<dir>/<anything>kitty<anything>-<pid>`
 * (kitty's `listen_on unix:/run/user/1000/kitty-{kitty_pid}` convention).
 * `names` are the file names in the socket directory.
 */
export function socketNameForPid(names: string[], pid: number): string | null {
  const re = new RegExp(`kitty.*-${pid}$`)
  return names.find(n => re.test(n)) ?? null
}

/** File names in a directory that look like kitty remote-control sockets. */
export const looksLikeKittySocket = (name: string) => /kitty/.test(name)

export interface KittyWindowInfo {
  id: string; focused: boolean; osFocused: boolean; claude: boolean; herdr: boolean
  title: string; sshHost: string | null
}

/** Parse `kitten @ ls` JSON into the few facts the listener needs. */
export function parseKittyLs(json: string): KittyWindowInfo[] {
  const out: KittyWindowInfo[] = []
  for (const os of JSON.parse(json)) for (const tab of os.tabs) for (const w of tab.windows) {
    const fg: any[] = w.foreground_processes ?? []
    out.push({
      id: String(w.id), focused: !!w.is_focused, osFocused: !!os.is_focused,
      claude: fg.some(p => /(^|\/)claude$/.test(p.cmdline?.[0] ?? '')),
      herdr: fg.some(p => /(^|\/)herdr$/.test(p.cmdline?.[0] ?? '')),
      title: String(w.title ?? ''),
      sshHost: fg.map(p => sshDestination(p.cmdline ?? [])).find(h => h) ?? null,
    })
  }
  return out
}

// Which candidate pane is the one actually drawn in the user's window? Neither
// the herdr window title nor the server's global focus is reliable alone (the
// title can be stale after switching workspaces; the global focus can belong to
// another client). So count each candidate's recent lines that appear in the
// window's screen text. Lines every session shares (quota, weather) hit every
// candidate equally and cancel out; cwd and branch lines decide. Returns the
// clear winner, or null when there is no clear winner (a tie, or no match).
export function pickByScreen(screen: string, candidates: Array<{ pane: string; text: string }>): string | null {
  const flat = screen.replace(/[ \t]+/g, ' ')
  const scored = candidates.map(c => {
    const lines = c.text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(l => l.length >= 16)
    let hits = 0
    for (const l of lines) if (flat.includes(l.slice(0, 40))) hits++
    return { pane: c.pane, hits }
  }).sort((a, b) => b.hits - a.hits)
  const best = scored[0]
  if (!best || best.hits === 0) return null
  if (scored.length > 1 && scored[1]!.hits === best.hits) return null
  return best.pane
}

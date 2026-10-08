import { describe, expect, test } from 'bun:test'
import { parseKittyLs, pickByScreen, pickHerdrPane, socketNameForPid, sshDestination, workspaceFromTitle } from './target'

describe('sshDestination', () => {
  test.each([
    [['ssh', 'host2'], 'host2'],
    [['/usr/bin/ssh', 'me@host2'], 'host2'],
    [['ssh', '-p', '2222', '-i', '/k', 'host2.example.net', 'herdr'], 'host2.example.net'],
    [['ssh', '-tt', 'host2'], 'host2'],
    [['claude', '--x'], null],
    [['ssh'], null],
  ])('%p -> %p', (argv, want) => {
    expect(sshDestination(argv as string[])).toBe(want as string | null)
  })
})

describe('workspaceFromTitle', () => {
  test('herdr title "{hostname}: {workspace}"', () => {
    expect(workspaceFromTitle('host2: my-project')).toBe('my-project')
    expect(workspaceFromTitle('host2: my project')).toBe('my project')
  })
  test('not a herdr title', () => {
    expect(workspaceFromTitle('✳ Bug fixes')).toBe(null)
    expect(workspaceFromTitle('')).toBe(null)
  })
})

// Shaped like a live herdr snapshot: the server's global focus is in
// "other-project", but this client shows "my-project".
const snap = {
  focused_pane_id: 'wA:p1',
  workspaces: [
    { workspace_id: 'wA', label: 'other-project', active_tab_id: 'wA:t1' },
    { workspace_id: 'wB', label: 'my-project', active_tab_id: 'wB:t1' },
    { workspace_id: 'wX', label: 'twin', active_tab_id: 'wX:t1' },
    { workspace_id: 'wY', label: 'twin', active_tab_id: 'wY:t1' },
  ],
  layouts: [
    { tab_id: 'wA:t1', focused_pane_id: 'wA:p1' },
    { tab_id: 'wB:t1', focused_pane_id: 'wB:p2' },
  ],
  panes: [
    { pane_id: 'wA:p1', agent: 'claude', agent_status: 'blocked', focused: true },
    { pane_id: 'wB:p1', agent: 'claude', agent_status: 'idle', focused: false },
    { pane_id: 'wB:p2', agent: 'claude', agent_status: 'idle', focused: false },
  ],
}

describe('pickHerdrPane', () => {
  test("picks the focused pane of the named workspace, not the global focus", () => {
    expect(pickHerdrPane(snap, 'my-project')).toEqual({ pane_id: 'wB:p2', agent: 'claude', agent_status: 'idle' })
  })
  test('unknown or ambiguous workspace is an error, never a guess', () => {
    expect('error' in pickHerdrPane(snap, 'nope')).toBe(true)
    expect('error' in pickHerdrPane(snap, 'twin')).toBe(true)
  })
})

describe('socketNameForPid', () => {
  const names = ['kitty-4242', 'kitty-99', 'wayland-1', 'my-kitty-7']
  test('finds the socket named after the pid', () => {
    expect(socketNameForPid(names, 4242)).toBe('kitty-4242')
    expect(socketNameForPid(names, 7)).toBe('my-kitty-7')
  })
  test('no match, no guess (and 42 does not match 4242)', () => {
    expect(socketNameForPid(names, 42)).toBe(null)
    expect(socketNameForPid(names, 5)).toBe(null)
  })
})

describe('parseKittyLs', () => {
  const ls = JSON.stringify([{ is_focused: true, tabs: [{ windows: [
    { id: 1, is_focused: true, title: 'shell', foreground_processes: [{ cmdline: ['/usr/bin/claude'] }] },
    { id: 2, is_focused: false, title: 'host2: my-project', foreground_processes: [{ cmdline: ['ssh', '-t', 'me@host2', 'herdr'] }] },
    { id: 3, is_focused: false, title: 'x', foreground_processes: [{ cmdline: ['bash'] }, { cmdline: ['herdr'] }] },
    { id: 4, is_focused: false, title: 'y', foreground_processes: [{ cmdline: ['/usr/bin/claude-wrapper'] }] },
  ] }] }])
  test('only a foreground process named claude counts as claude', () => {
    const w = parseKittyLs(ls)
    expect(w.map(x => x.claude)).toEqual([true, false, false, false])
    expect(w[0]).toMatchObject({ id: '1', focused: true, osFocused: true })
  })
  test('ssh and herdr are recognised', () => {
    const w = parseKittyLs(ls)
    expect(w[1]!.sshHost).toBe('host2')
    expect(w[2]!.herdr).toBe(true)
  })
})

describe('pickByScreen', () => {
  const screen = [
    ' ● Local · alpha   ▕│ ✻ Crunched for 3m · done 9:03 PM',
    '   claude          ▕│ ▸ ~/Projects/my-project │ ⎇ main │ ⛨ hooks 41/41',
    ' ○ Local · beta    ▕│ ⏳ week 26% · +26% banked ≈1d ahead ↻Sun',
  ].join('\n')
  const mine = '✻ Crunched for 3m · done 9:03 PM\n▸ ~/Projects/my-project │ ⎇ main │ ⛨ hooks 41/41\n⏳ week 26% · +26% banked ≈1d ahead ↻Sun'
  const other = '● Bug fixes and pull requests\n▸ ~/Projects/other-project │ ⎇ main │ ⛨ hooks 41/41\n⏳ week 26% · +26% banked ≈1d ahead ↻Sun'

  test('the pane whose own lines are on screen wins; shared lines cancel out', () => {
    expect(pickByScreen(screen, [{ pane: 'wA:p1', text: other }, { pane: 'wB:p1', text: mine }])).toBe('wB:p1')
  })
  test('a single candidate must still appear on screen', () => {
    expect(pickByScreen(screen, [{ pane: 'wB:p1', text: mine }])).toBe('wB:p1')
    expect(pickByScreen(screen, [{ pane: 'wA:p1', text: 'something that is not drawn anywhere here' }])).toBe(null)
  })
  test('a tie or no match picks nobody', () => {
    expect(pickByScreen(screen, [{ pane: 'a', text: 'nothing here at all' }, { pane: 'b', text: 'nor here either friend' }])).toBe(null)
    const shared = '⏳ week 26% · +26% banked ≈1d ahead ↻Sun'
    expect(pickByScreen(screen, [{ pane: 'a', text: shared }, { pane: 'b', text: shared }])).toBe(null)
  })
})

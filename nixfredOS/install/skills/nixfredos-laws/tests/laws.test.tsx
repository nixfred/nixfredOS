import { describe, expect, mock, test } from 'claude-code/testing'

import { classify, gitIntent, githubSlug, parseRemotes, tripwire } from '../hooks/laws'

const REMOTES = [
  'origin\thttps://github.com/you/project.git (fetch)',
  'origin\thttps://github.com/you/project.git (push)',
  'upstream\thttps://github.com/them/project.git (fetch)',
  'upstream\tDISABLED (push)',
].join('\n')

const BAND = {
  plugin: 'nixfredos-laws',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

describe('pure rules', () => {
  test('gitIntent finds the verb, the directory and the remote', () => {
    expect(gitIntent('git -C ~/work commit -m "x"')).toEqual({ verb: 'commit', dir: '~/work' })
    expect(gitIntent('cd "/tmp/a b" && git push -u fork main')).toEqual({ verb: 'push', dir: '/tmp/a b', remote: 'fork' })
    expect(gitIntent('git push --set-upstream origin feat')).toEqual({ verb: 'push', remote: 'origin' })
    expect(gitIntent('git push')).toEqual({ verb: 'push' })
    expect(gitIntent('git status && git log --oneline')).toBeUndefined()
  })

  test('classify reads the push URL and what gh said', () => {
    const remotes = parseRemotes(REMOTES)
    expect(classify(remotes['upstream'] ?? '', '').privacy).toBe('never')
    expect(classify(remotes['origin'] ?? '', 'PUBLIC').privacy).toBe('public')
    expect(classify(remotes['origin'] ?? '', 'PRIVATE').privacy).toBe('private')
    expect(classify(remotes['origin'] ?? '', '').privacy).toBe('unknown')
    expect(classify('', '').privacy).toBe('none')
  })

  test('githubSlug reads https and ssh URLs, and nothing else', () => {
    expect(githubSlug('https://github.com/you/project.git')).toBe('you/project')
    expect(githubSlug('git@github.com:you/project')).toBe('you/project')
    expect(githubSlug('https://gitlab.com/you/project.git')).toBeUndefined()
  })

  test('no tripwire ships armed', () => {
    expect(tripwire('git push --force origin main')).toBeUndefined()
  })
})

describe('in the engine', () => {
  test('a push to a never-push remote is refused and origin goes through', async ($, on) => {
    let ran = 0
    let asked = 0
    on('process.run', ($, e) => {
      if (e.argv[0] === 'gh') {
        asked += 1

        return { value: { exitCode: 0, stdout: 'PUBLIC\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }

      return { value: { exitCode: 0, stdout: REMOTES, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    mock.env(on, { HOME: '/home/you' })
    on('session.cwd', () => ({ value: '/home/you/project' }))
    on('tool.call', { tool: 'Bash' }, () => {
      ran += 1

      return { result: {} }
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>the engine band</Text>
    })

    const refused = await $.tool.call({ tool: 'Bash', command: 'git push upstream main' })
    expect(refused.deny).toMatch(/push to upstream .* refused/)
    expect(ran).toBe(0)

    const allowed = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    expect(allowed.deny).toBeUndefined()
    expect(ran).toBe(1)

    await $.tool.call({ tool: 'Bash', command: 'git commit -m again' })
    expect(asked).toBe(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /commit → origin you\/project · PUBLIC/ })).toBeDefined()
    await ui.unmount()
  })

  test('the third failed Bash call of a turn carries the note, once', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'boom', text: 'boom' }))

    const first = await $.tool.call({ tool: 'Bash', command: 'false' })
    const second = await $.tool.call({ tool: 'Bash', command: 'false' })
    const third = await $.tool.call({ tool: 'Bash', command: 'false' })
    const fourth = await $.tool.call({ tool: 'Bash', command: 'false' })

    expect(first.context).toBeUndefined()
    expect(second.context).toBeUndefined()
    expect(third.context?.[0]).toMatch(/failed Bash call #3/)
    expect(fourth.context).toBeUndefined()
  })

  test('the band is quiet, then speaks, then hides on a press, on every surface', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'boom', text: 'boom' }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>the engine band</Text>
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const quiet = await $.ui.mount({ ...BAND, surface })
      expect(await quiet.find({ type: 'Text', text: /failed/ })).toBeUndefined()
      await quiet.unmount()
    }

    await $.tool.call({ tool: 'Bash', command: 'false' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: /✗ 1\/3 failed/ })).toBeDefined()
      expect(await ui.find({ key: 'research' })).toBeUndefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'hide' })
    await ui.unmount()

    const hidden = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await hidden.find({ type: 'Text', text: /failed/ })).toBeUndefined()
    await hidden.unmount()
  })

  test('at three strikes the research button queues a prompt', async ($, on) => {
    const queued: string[] = []
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'boom', text: 'boom' }))
    on('prompt.submit', ($, e) => {
      queued.push(e.text)

      return { text: e.text }
    })

    await $.tool.call({ tool: 'Bash', command: 'false' })
    await $.tool.call({ tool: 'Bash', command: 'false' })
    await $.tool.call({ tool: 'Bash', command: 'false' })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'research' })
    await ui.unmount()

    expect(queued[0]).toMatch(/Stop trying variants/)
  })
})

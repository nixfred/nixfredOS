import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Privacy, RemoteRead } from '../types'
import {
  classify,
  gitIntent,
  githubSlug,
  parseRemotes,
  RESEARCH_PROMPT,
  short,
  strikeNote,
  STRIKES,
  tripwire,
} from './laws'

const failures = atom({ plugin: 'nixfredos-laws', key: 'failures' } as const, 0)
const remote = atom({ plugin: 'nixfredos-laws', key: 'remote' } as const, null)
const isHidden = atom({ plugin: 'nixfredos-laws', key: 'isHidden' } as const, false)

const TINT: Record<Privacy, string> = {
  private: 'green',
  public: 'yellow',
  never: 'red',
  unknown: 'cyan',
  none: 'yellow',
}

export const register: Register = on => {
  // What `gh` said about each repo this session, so a turn of ten commits asks once.
  const visibility = new Map<string, string>()

  on('prompt.submit', async ($, e, next) => {
    await update($, failures, () => 0)
    await update($, remote, () => null)
    await update($, isHidden, () => false)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const tripped = tripwire(e.command)

    if (tripped !== undefined) {
      return { deny: `${$.plugin.name}: ${tripped}` }
    }

    // Read the remote out before any commit or push runs.
    const intent = gitIntent(e.command)

    if (intent !== undefined) {
      const home = (await $.env.get('HOME')) ?? ''
      const cwd = (intent.dir ?? (await $.session.cwd())).replace(/^~(?=\/|$)/, home)
      const listed = await $.process.run(['git', '-C', cwd, 'remote', '-v'])

      if (listed.exitCode === 0) {
        const name = intent.remote ?? 'origin'
        const url = parseRemotes(listed.stdout)[name] ?? ''
        const slug = githubSlug(url)

        if (slug !== undefined && !visibility.has(slug)) {
          const asked = await $.process.run(
            ['gh', 'repo', 'view', slug, '--json', 'visibility', '-q', '.visibility'],
            { timeoutMs: 5000 },
          )
          visibility.set(slug, asked.exitCode === 0 ? asked.stdout.trim() : '')
        }

        const seen: RemoteRead = {
          verb: intent.verb,
          remote: name,
          url,
          ...classify(url, slug === undefined ? '' : (visibility.get(slug) ?? '')),
        }
        await update($, remote, () => seen)

        if (seen.verb === 'push' && seen.privacy === 'never') {
          return { deny: `${$.plugin.name}: push to ${name} (${short(url)}) refused, it is ${seen.label}.` }
        }
      }
    }

    const ran = await next(e)

    // Count this turn's failed Bash calls on the main loop, and say so once at the line.
    if (ran.isError === true && e.agentId === undefined) {
      const count = await update($, failures, n => (n ?? 0) + 1)

      if (count === STRIKES) {
        return { ...ran, context: [...(ran.context ?? []), strikeNote(count)] }
      }
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const failed = await read($, failures)
    const seen = await read($, remote)
    const isQuiet = failed === 0 && seen === null

    if (e.props.hasSurvey || isQuiet || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const isOut = failed >= STRIKES

    return (
      <Box>
        {failed > 0 && (
          <Text color={isOut ? 'red' : 'yellow'}>
            {'✗'.repeat(Math.min(failed, 9))} {failed}/{STRIKES} failed{isOut ? ', stop and research' : ''}{'  '}
          </Text>
        )}
        {isOut && (
          <Button
            key="research"
            label="research"
            onPress={async () => {
              try {
                await $.prompt.submit({ text: RESEARCH_PROMPT })
              } catch {
                $.ui.toast('nixfredos-laws: could not queue the research prompt')
              }
            }}
          />
        )}
        {seen !== null && (
          <Text color={TINT[seen.privacy]} wrap="truncate-end">
            {failed > 0 ? '  │  ' : ''}
            {seen.verb} → {seen.remote} {short(seen.url)} · {seen.label}{'  '}
          </Text>
        )}
        <Button key="hide" label="hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}

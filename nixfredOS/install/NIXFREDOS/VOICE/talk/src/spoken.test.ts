import { describe, expect, test } from 'bun:test'
import { spokenPrompt } from './spoken'

describe('spokenPrompt', () => {
  test('mark, origin host, words', () => {
    expect(spokenPrompt('what time is it', 'laptop')).toBe('🎙️ laptop: what time is it')
    expect(spokenPrompt('  check the build ', 'host-2')).toBe('🎙️ host-2: check the build')
  })
  test('no origin, or one unsafe for ssh: the bare mark (old behaviour)', () => {
    expect(spokenPrompt('hello')).toBe('🎙️ hello')
    for (const bad of ['-oProxyCommand=x', 'a b', 'h;rm', '', 'a.b'])
      expect(spokenPrompt('hello', bad)).toBe('🎙️ hello')
  })
})

import { describe, expect, test } from 'bun:test'
import { cleanVocabulary, Corrector } from './vocabulary'

describe('Corrector', () => {
  const c = new Corrector()

  test('the mishearing that started this: Amachi', () => {
    expect(c.apply('when is the next big Amachi release probable?')).toBe('when is the next big Omarchy release probable?')
  })
  test.each([
    ['open Omarchi settings', 'open Omarchy settings'],
    ['oh march he is great', 'Omarchy is great'],
    ['restart hyper land please', 'restart Hyprland please'],
    ['push it to github', 'push it to GitHub'],
    ['install nix fred os', 'install nixfredOS'],
  ])('%p -> %p', (input, want) => {
    expect(c.apply(input)).toBe(want)
  })

  test('never inside a word, domain, path or hyphenation', () => {
    expect(c.apply('see omachi.example.com')).toBe('see omachi.example.com')
    expect(c.apply('cd ~/omarchi/src')).toBe('cd ~/omarchi/src')
    expect(c.apply('the omarchi-theme repo')).toBe('the omarchi-theme repo')
    expect(c.apply('mail me@omachi')).toBe('mail me@omachi')
  })

  test('ordinary words are left alone', () => {
    expect(c.apply('the cloud is a herder of pseudo data')).toBe('the cloud is a herder of pseudo data')
  })

  test('user terms are added and normalised', () => {
    const u = new Corrector({ Acme: ['ack me', 'acmee'], Bad: 'not a list', '': ['x'] })
    expect(u.apply('process PRs on ack me')).toBe('process PRs on Acme')
    expect(u.apply('open acmee')).toBe('open Acme')
  })

  test('punctuation around a match is kept', () => {
    expect(c.apply('Is it Amachi? Yes, Amachi.')).toBe('Is it Omarchy? Yes, Omarchy.')
  })
})

describe('cleanVocabulary', () => {
  test('drops malformed entries', () => {
    expect(cleanVocabulary({ A: ['a', 3, ''], B: 'x', ' ': ['y'] })).toEqual({ A: ['a'] })
    expect(cleanVocabulary(null)).toEqual({})
    expect(cleanVocabulary(['x'])).toEqual({})
  })
})

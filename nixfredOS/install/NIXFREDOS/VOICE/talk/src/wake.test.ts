import { describe, expect, test } from 'bun:test'
import { buildStrictWake, checkWakeWord, DEFAULT_WAKE_WORD, editDistance, looseTolerance } from './wake'

describe('default wake word', () => {
  test('is "Computer" when nothing is configured', () => {
    expect(DEFAULT_WAKE_WORD).toBe('Computer')
    expect(checkWakeWord('Computer, what time is it?').rest).toBe('what time is it?')
  })
})

describe('checkWakeWord (strict)', () => {
  test.each([
    ['Jarvis, what time is it?', 'what time is it?'],
    ['jarvis what time is it', 'what time is it'],
    ['Hey Jarvis, check the build.', 'check the build.'],
    ['OK Jarvis turn it down', 'turn it down'],
    ["Jarvis's turn. Go.", 'turn. Go.'],
    ['Jarvis.', ''],
  ])('%p wakes', (text, rest) => {
    const r = checkWakeWord(text, { name: 'Jarvis' })
    expect(r.ok).toBe(true)
    expect(r.rest).toBe(rest)
  })

  test.each([
    'What time is it, Jarvis?',
    'Service, what time is it?',
    'and then Jarvis said no',
    'Jarvisize the thing',
    'Thanks for watching.',
    '',
  ])('%p does not wake', text => {
    expect(checkWakeWord(text, { name: 'Jarvis' }).ok).toBe(false)
  })

  test('another name does not wake', () => {
    expect(checkWakeWord('Computer, what time is it?', { name: 'Jarvis' }).ok).toBe(false)
  })

  test('a name with regex characters is escaped', () => {
    expect(checkWakeWord('c.3po, hello', { name: 'C.3PO' }).ok).toBe(true)
    expect(checkWakeWord('cx3po, hello', { name: 'C.3PO' }).ok).toBe(false)
  })

  test('a two-word name matches across spacing', () => {
    expect(checkWakeWord('Hey Orion, status?', { name: 'Hey Orion' }).ok).toBe(true)
    expect(buildStrictWake('Star Light').test('star-light go')).toBe(true)
  })
})

describe('checkWakeWord loose (voice print already confirmed the user)', () => {
  test.each([
    ['Commuter, what time is it?', 'what time is it?'],       // distance 1
    ['Compuder what time is it', 'what time is it'],           // distance 2
    ['How are you? Computer, what time is it?', 'what time is it?'],
    ["Hey there you Computer's turn", "turn"],
  ])('%p wakes when loose', (text, rest) => {
    const r = checkWakeWord(text, { name: 'Computer', loose: true })
    expect(r.ok).toBe(true)
    expect(r.rest).toBe(rest)
  })

  test('strict mode still rejects near-misses', () => {
    expect(checkWakeWord('Commuter, what time is it?', { name: 'Computer' }).ok).toBe(false)
  })

  test('loose mode needs the name in the first four words', () => {
    expect(checkWakeWord('we went to the store and then Computer said hi', { name: 'Computer', loose: true }).ok).toBe(false)
    expect(checkWakeWord('one two three Computer go', { name: 'Computer', loose: true }).ok).toBe(true)
    expect(checkWakeWord('one two three four Computer go', { name: 'Computer', loose: true }).ok).toBe(false)
  })

  test('three edits is too far', () => {
    expect(checkWakeWord('Commutor, what time is it?', { name: 'Computer', loose: true }).ok).toBe(true) // 2
    expect(checkWakeWord('Compass rose, hello', { name: 'Computer', loose: true }).ok).toBe(false) // 3+
  })

  test('names under 4 characters are exact-only even when loose', () => {
    expect(looseTolerance('Ava')).toBe(0)
    expect(looseTolerance('Nova')).toBe(2)
    expect(checkWakeWord('Eve, hello', { name: 'Ava', loose: true }).ok).toBe(false)
    expect(checkWakeWord('Ava, hello', { name: 'Ava', loose: true }).ok).toBe(true)
  })

  test('a near-miss of a short word does not leak through other words', () => {
    // "Mary" is 2 edits from "Harry": loose accepts, which is the point of loose mode.
    expect(checkWakeWord('Mary, what time?', { name: 'Harry', loose: true }).ok).toBe(true)
    expect(checkWakeWord('Mary, what time?', { name: 'Harry' }).ok).toBe(false)
  })
})

describe('editDistance', () => {
  test('basics', () => {
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

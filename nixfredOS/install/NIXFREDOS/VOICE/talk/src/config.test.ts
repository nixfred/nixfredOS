import { describe, expect, test } from 'bun:test'
import { listenAllowed, micTarget, pathsFor, resolveWakeWord, shortHost } from './config'

describe('listenAllowed (fail closed)', () => {
  test('only enabled === true or listen === true opens the mic', () => {
    expect(listenAllowed({ enabled: true })).toBe(true)
    expect(listenAllowed({ enabled: false, listen: true })).toBe(true)
    for (const v of [null, undefined, {}, { enabled: false }, { enabled: 'true' }, { enabled: 1 }, 'on',
                     { listen: 'true' }, { listen: 1 }, { enabled: false, listen: false }])
      expect(listenAllowed(v)).toBe(false)
  })
})

describe('micTarget', () => {
  test('env wins, then voice.json "mic", else the default source', () => {
    expect(micTarget({ mic: 'usb-mic' }, { NIXFREDOS_VOICE_MIC_TARGET: 'env-mic' })).toBe('env-mic')
    expect(micTarget({ mic: ' usb-mic ' }, {})).toBe('usb-mic')
    expect(micTarget({ mic: '' }, { NIXFREDOS_VOICE_MIC_TARGET: '  ' })).toBe(undefined)
    expect(micTarget(null, {})).toBe(undefined)
  })
})

describe('shortHost', () => {
  test('the first label, or a safe placeholder', () => {
    expect(shortHost('laptop.lan')).toBe('laptop')
    expect(shortHost('desk')).toBe('desk')
    expect(shortHost('-bad')).toBe('host')
    expect(shortHost('')).toBe('host')
  })
})

describe('resolveWakeWord', () => {
  test('voice.json wake_word wins', () => {
    expect(resolveWakeWord({ wake_word: 'Nova' }, { daidentity: { name: 'Atlas' } })).toBe('Nova')
  })
  test('else the DA identity name', () => {
    expect(resolveWakeWord({}, { daidentity: { name: 'Atlas' } })).toBe('Atlas')
    expect(resolveWakeWord(null, { daidentity: { name: ' Atlas ' } })).toBe('Atlas')
  })
  test('else "Computer"', () => {
    expect(resolveWakeWord(null, null)).toBe('Computer')
    expect(resolveWakeWord({ wake_word: '  ' }, { daidentity: {} })).toBe('Computer')
  })
  test('product default names are not wake words', () => {
    expect(resolveWakeWord(null, { daidentity: { name: 'nixfredOS' } })).toBe('Computer')
    expect(resolveWakeWord(null, { daidentity: { name: 'PAI' } })).toBe('Computer')
    expect(resolveWakeWord({ wake_word: 'nixfredOS' }, null)).toBe('nixfredOS') // explicit choice still wins
  })
})

describe('pathsFor', () => {
  test('state, models and voice print live under the nixfredos-voice dirs', () => {
    const p = pathsFor('/h')
    expect(p.state).toBe('/h/.local/state/nixfredos-voice')
    expect(p.models).toBe('/h/.local/share/nixfredos-voice/models')
    expect(p.voiceprint).toBe('/h/.config/nixfredos-voice/voiceprint.json')
    expect(pathsFor('/h', 'desk').hostVoiceprint).toBe('/h/.config/nixfredos-voice/voiceprint.desk.json')
    expect(p.voiceJson).toBe('/h/.claude/voice.json')
  })
})

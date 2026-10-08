// Paths, the voice switch and the wake word. Everything takes its inputs as
// parameters (home, file contents) so it is testable without touching the real
// home directory.
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { PULSE_BASE } from '../../../PULSE/endpoint'
import { DEFAULT_WAKE_WORD } from './wake'

/** Voice server (Pulse). PULSE_URL overrides, see PULSE/endpoint.ts. */
export const VOICE_SERVER = PULSE_BASE

export interface Paths {
  state: string        // listen.log, listen.jsonl
  models: string       // downloaded models
  voiceprint: string   // the enrolled voice print (0600)
  vocabulary: string   // the user's own word corrections
  voiceJson: string    // the on/off switch + options
  settingsJson: string // DA identity mirror
}

export function pathsFor(home = homedir()): Paths {
  return {
    state: join(home, '.local/state/nixfredos-voice'),
    models: join(home, '.local/share/nixfredos-voice/models'),
    voiceprint: join(home, '.config/nixfredos-voice/voiceprint.json'),
    vocabulary: join(home, '.config/nixfredos-voice/vocabulary.json'),
    voiceJson: join(home, '.claude/voice.json'),
    settingsJson: join(home, '.claude/settings.json'),
  }
}

export const PATHS = pathsFor()

export const SPEAKER_MODEL = '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx'
export const WHISPER_MODEL = 'ggml-base.en.bin'

function readJson(path: string): any {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null } catch { return null }
}

/**
 * The listener opens the mic only when voice.json says "enabled": true.
 * Missing file, bad JSON or any other value: off (fail closed).
 */
export function listenAllowed(voiceJson: any): boolean {
  return !!voiceJson && voiceJson.enabled === true
}

// Product default names are not names a person says, and speech-to-text
// mangles them, so they count as "no name set" for the wake word.
const NOT_A_WAKE_WORD = new Set(['nixfredos', 'pai', 'assistant', 'da'])

/** Wake word: voice.json "wake_word", else the DA identity name, else "Computer". */
export function resolveWakeWord(voiceJson: any, settingsJson: any): string {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const daName = pick(settingsJson?.daidentity?.name)
  return pick(voiceJson?.wake_word)
    ?? (daName && !NOT_A_WAKE_WORD.has(daName.toLowerCase()) ? daName : null)
    ?? DEFAULT_WAKE_WORD
}

export function loadSwitch(paths = PATHS) {
  const voice = readJson(paths.voiceJson)
  const settings = readJson(paths.settingsJson)
  return { allowed: listenAllowed(voice), wakeWord: resolveWakeWord(voice, settings), voice }
}

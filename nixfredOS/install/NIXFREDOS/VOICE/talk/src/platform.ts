// Platform glue: binary lookup, kitty sockets, whisper model search.
// Linux is the supported path. The macOS branch is EXPERIMENTAL and untested.
import { spawnSync } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { homedir, platform, tmpdir } from 'os'
import { delimiter, join } from 'path'
import { PATHS, WHISPER_MODEL } from './config'
import { looksLikeKittySocket } from './target'

export const OS: 'linux' | 'darwin' | 'other' =
  platform() === 'linux' ? 'linux' : platform() === 'darwin' ? 'darwin' : 'other'

// A service often runs with a thin PATH; Homebrew and ~/.local/bin are checked too.
const EXTRA_BIN = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local/bin')]

export function which(name: string): string | null {
  for (const dir of [...(process.env.PATH ?? '').split(delimiter), ...EXTRA_BIN]) {
    if (!dir) continue
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

export const RUN_DIR = `/run/user/${process.getuid?.() ?? 1000}`

/** Directories that may hold kitty remote-control sockets. */
export function kittySocketDirs(): string[] {
  const dirs = [process.env.NIXFREDOS_KITTY_SOCKET_DIR, RUN_DIR, tmpdir(), '/tmp']
  return [...new Set(dirs.filter((d): d is string => !!d && existsSync(d)))]
}

/** Every kitty socket we can find, as `unix:<path>` addresses. */
export function kittySockets(): string[] {
  const out: string[] = []
  for (const dir of kittySocketDirs()) {
    let names: string[] = []
    try { names = readdirSync(dir).filter(looksLikeKittySocket) } catch {}
    for (const n of names) {
      try { if (statSync(join(dir, n)).isSocket()) out.push(`unix:${join(dir, n)}`) } catch {}
    }
  }
  return out
}

/** Directories searched for whisper models, in order. NIXFREDOS_WHISPER_MODEL_DIR goes first. */
export function whisperModelDirs(): string[] {
  const home = homedir()
  return [
    process.env.NIXFREDOS_WHISPER_MODEL_DIR,
    PATHS.models,
    join(home, '.local/share/voxtype/models'),
    '/usr/share/whisper.cpp/models',
    '/opt/homebrew/share/whisper-cpp/models',
    '/usr/local/share/whisper-cpp/models',
  ].filter((d): d is string => !!d)
}

export function findWhisperModel(names = ['ggml-small.en.bin', WHISPER_MODEL]): string | null {
  if (process.env.NIXFREDOS_WHISPER_MODEL && existsSync(process.env.NIXFREDOS_WHISPER_MODEL)) return process.env.NIXFREDOS_WHISPER_MODEL
  for (const name of names) for (const dir of whisperModelDirs()) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

/** Run a short command, never throw, return stdout or null. */
export function run(bin: string, args: string[], timeout = 2000): string | null {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout, maxBuffer: 16 << 20 })
  return r.status === 0 ? r.stdout : null
}

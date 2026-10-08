#!/usr/bin/env bun
// Fetch the models and check the tools. No sudo: it only writes under
// ~/.local/share/nixfredos-voice/models and tells you what to install.
//   bun scripts/setup.ts
import { existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { PATHS, SPEAKER_MODEL, WHISPER_MODEL } from '../src/config'
import { OS, which } from '../src/platform'

const MODELS = [
  { file: WHISPER_MODEL, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin', what: 'whisper speech-to-text (~142 MB)' },
  // "recongition" is the real, misspelled release tag upstream.
  { file: SPEAKER_MODEL, url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx', what: 'speaker voice print (~26 MB)' },
]

async function download(url: string, dest: string) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  const tmp = dest + '.part'
  await Bun.write(tmp, res)
  renameSync(tmp, dest)
}

let problems = 0
console.log(`platform: ${OS}${OS === 'darwin' ? ' (EXPERIMENTAL, untested)' : ''}`)
mkdirSync(PATHS.models, { recursive: true })
for (const m of MODELS) {
  const dest = join(PATHS.models, m.file)
  if (existsSync(dest) && statSync(dest).size > 1_000_000) { console.log(`ok       ${m.file}`); continue }
  // An existing whisper model elsewhere is found at run time, but fetching is cheap and predictable.
  console.log(`fetching ${m.file}: ${m.what}`)
  try { await download(m.url, dest); console.log(`ok       ${m.file}`) }
  catch (e: any) { problems++; console.log(`FAILED   ${m.file}: ${e?.message ?? e}`) }
}

type Check = { bin: string; need: boolean; hint: Record<string, string> }
const checks: Check[] = [
  { bin: 'whisper-server', need: true, hint: { linux: 'install whisper.cpp from your package manager (Arch: pacman -S whisper.cpp; otherwise build github.com/ggml-org/whisper.cpp and put whisper-server on PATH)', darwin: 'brew install whisper-cpp' } },
  OS === 'darwin'
    ? { bin: 'ffmpeg', need: true, hint: { darwin: 'brew install ffmpeg' } }
    : { bin: 'pw-record', need: true, hint: { linux: 'install pipewire (pw-record) and pipewire-pulse (pactl)' } },
  { bin: 'kitten', need: true, hint: { linux: 'install kitty (it ships `kitten`); typing needs allow_remote_control and listen_on in kitty.conf', darwin: 'brew install --cask kitty; typing needs allow_remote_control and listen_on in kitty.conf' } },
  { bin: 'herdr', need: false, hint: { linux: 'optional: herdr, to type into herdr panes locally or over ssh', darwin: 'optional: herdr' } },
  ...(OS === 'linux' ? [{ bin: 'hyprctl', need: false, hint: { linux: 'optional: Hyprland provides hyprctl, used to find the focused window; without it only the single-claude-window fallback works' } } as Check] : []),
]
for (const c of checks) {
  const p = which(c.bin)
  if (p) { console.log(`ok       ${c.bin} (${p})`); continue }
  if (c.need) problems++
  console.log(`${c.need ? 'MISSING ' : 'optional'} ${c.bin}: ${c.hint[OS] ?? c.hint.linux ?? ''}`)
}
if (OS === 'other') { problems++; console.log('unsupported platform: Linux is supported, macOS is experimental') }

console.log(problems ? `\n${problems} thing(s) to fix, then run this again.` : '\nAll set. Next: bun scripts/enroll.ts')
process.exit(problems ? 1 : 0)

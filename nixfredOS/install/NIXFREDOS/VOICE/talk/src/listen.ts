#!/usr/bin/env bun
/**
 * nixfredOS voice listener: talk to the Claude Code session you are IN, in its
 * own terminal.
 *
 * Mic -> personal VAD (voice print) -> whisper -> wake word -> types
 * "🎙️ <words>" + Enter into the kitty window running the session (kitten @
 * send-text), or into the herdr pane running claude. Nothing is typed unless
 * the utterance starts with the wake word. Hooks on the other side react to
 * the 🎙️ prefix and answer out loud.
 *
 * Safety: before typing, the target window's foreground process must be
 * `claude` (or the herdr pane's agent must be claude); otherwise nothing is
 * typed (never into a bare shell).
 *
 * Does nothing unless ~/.claude/voice.json has "enabled": true (fail closed).
 *
 *   bun src/listen.ts [--to unix:/run/user/1000/kitty-1234 --window 1]
 * (seed only: it types into the Claude window you are looking at)
 *
 * Linux is supported. macOS is EXPERIMENTAL and untested.
 */
import { spawnSync } from 'child_process'
import { Corrector } from './vocabulary'
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { EnergyVad, isNoiseTranscript, pcmToWav, type Utterance } from './ears'
import { checkWakeWord } from './wake'
import { loadSwitch, PATHS } from './config'
import { Mic } from './mic'
import { WhisperServer } from './whisper'
import { VoicePrint } from './voiceprint'
import { OwnerVad, type OwnerUtterance } from './ownervad'
import { getSpeaking, notify } from './pulse'
import { kittySockets, OS, run, which } from './platform'
import { parseKittyLs, pickByScreen, pickHerdrPane, socketNameForPid, workspaceFromTitle, type KittyWindowInfo } from './target'

mkdirSync(PATHS.state, { recursive: true })
const LOG = join(PATHS.state, 'listen.log')
const METRICS = join(PATHS.state, 'listen.jsonl')
const log = (m: string) => { try { appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`) } catch {} }

// Fail closed: no switch, no mic.
const cfg = loadSwitch()
if (!cfg.allowed) {
  log('voice.json does not say "enabled": true; listener not started')
  console.error('voice listener is off (set "enabled": true in ~/.claude/voice.json, or run `nixfredos-voice listen on`)')
  process.exit(0)
}
const WAKE = cfg.wakeWord
const say = (message: string) => notify(message, WAKE)

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }

// Which session hears you:
//   1. the kitty window you are looking at, if it runs claude (or herdr/ssh, below);
//   2. else the only kitty window running claude;
//   3. else the last window typed into, if it still runs claude;
//   4. else nobody: say so, type nothing.
// --to/--window (or the KITTY_* env of whoever started it) seed the "last" target.
// kitty: type into a kitty window running claude.
// herdr: the focused kitty window runs the herdr client; prompt the focused
//        herdr pane's claude through `herdr agent prompt`, which refuses when
//        that Claude is blocked at a question or approval dialog.
interface Target { to: string; window: string; herdrPane?: string; machine?: string }
let lastTarget: Target | null = (() => {
  const to = arg('--to') || process.env.KITTY_LISTEN_ON, window = arg('--window') || process.env.KITTY_WINDOW_ID
  return to && window ? { to, window } : null
})()

const KITTEN = () => which('kitten') ?? 'kitten'
const HERDR = () => which('herdr') ?? 'herdr'

function kittyWindows(to: string): KittyWindowInfo[] {
  const out = run(KITTEN(), ['@', '--to', to, 'ls'], 2000)
  if (!out) return []
  try { return parseKittyLs(out) } catch { return [] }
}

// The kitty socket of the focused window.
//   Linux: Hyprland's active window pid -> the socket named after that pid.
//   macOS (EXPERIMENTAL): no hyprctl; ask every kitty socket which OS window is focused.
function focusedKitty(): { to: string; win: KittyWindowInfo } | null {
  if (OS === 'darwin') {
    for (const to of kittySockets()) {
      const win = kittyWindows(to).find(w => w.focused && w.osFocused)
      if (win) return { to, win }
    }
    return null
  }
  const hyprctl = which('hyprctl')
  if (!hyprctl) return null
  const a = run(hyprctl, ['activewindow', '-j'])
  try {
    const pid = JSON.parse(a ?? '').pid
    const socks = kittySockets()
    const name = socketNameForPid(socks.map(s => s.split('/').pop()!), pid)
    const to = socks.find(s => s.endsWith('/' + name))
    if (!to) return null
    const win = kittyWindows(to).find(w => w.focused)
    return win ? { to, win } : null
  } catch { return null }
}

function resolveTarget(): Target | null {
  const f = focusedKitty()
  if (f) {
    const { to, win } = f
    if (win.claude) return { to, window: win.id }
    if (win.herdr) {
      const pane = herdrFocusedClaude()
      if (pane) return { to, window: win.id, herdrPane: pane }
    }
    if (win.sshHost) {
      // You are looking at another machine. Its herdr or nothing: never fall
      // back to a local window you are not looking at.
      const machine = herdrMachineFor(win.sshHost)
      const pane = machine ? remoteHerdrPane(machine, win.title, to, win.id) : null
      if (pane) return { to, window: win.id, herdrPane: pane, machine: machine! }
      log(`focused window is ssh ${win.sshHost}${machine ? '' : ' (no herdr machine profile)'}, title "${win.title}": no herdr Claude pane found`)
      return null
    }
  }
  // 2. the only claude window across all kitty sockets
  const all: Target[] = []
  for (const to of kittySockets()) for (const w of kittyWindows(to)) if (w.claude) all.push({ to, window: w.id })
  if (all.length === 1) return all[0]!
  // 3. the last target, if it still runs claude
  if (lastTarget && all.some(t => t.to === lastTarget!.to && t.window === lastTarget!.window)) return lastTarget
  return null
}

// Local herdr server only. Panes of other machines are reached through the
// ssh path below.
let herdrBlocked = false
function herdrFocusedClaude(): string | null {
  const out = run(HERDR(), ['pane', 'current'])
  try {
    const pane = JSON.parse(out ?? '').result?.pane
    if (pane?.agent !== 'claude') return null
    herdrBlocked = pane.agent_status === 'blocked'
    return pane.pane_id
  } catch { return null }
}

// Saved herdr machine profiles (herdr machine list --json), refreshed each minute.
let machinesAt = 0
let machines: Array<{ label: string; target: string; enabled: boolean }> = []
function herdrMachineFor(host: string): string | null {
  if (Date.now() - machinesAt > 60000) {
    const out = run(HERDR(), ['machine', 'list', '--json'], 3000)
    try { machines = JSON.parse(out ?? ''); machinesAt = Date.now() } catch {}
  }
  const short = host.split('.')[0]
  const m = machines.find(m => m.enabled && (m.target === host || m.label === host || m.label === short || m.target.split('@').pop() === host))
  return m?.label ?? null
}

// A remote herdr server has one GLOBAL focused pane, which may belong to
// another client, and the window title ("{hostname}: {workspace}", config.toml
// window_title on the remote) can be stale after you switch workspaces. Neither
// is trusted alone. Candidates (Claude panes only): the global focused pane and
// the title-workspace's focused pane. Each candidate's recent output is compared
// with this window's screen text, and only a clear winner is used. A tie or no
// match types NOTHING.
function remoteHerdrPane(machine: string, title: string, kittyTo: string, kittyWindow: string): string | null {
  const out = run(HERDR(), ['--machine', machine, 'api', 'snapshot'], 5000)
  let snap: any
  try { snap = JSON.parse(out ?? '').result.snapshot } catch (e: any) { log(`herdr ${machine} snapshot failed: ${e?.message ?? e}`); return null }
  const claudePane = (id: string | undefined) => (snap.panes ?? []).find((p: any) => p.pane_id === id && p.agent === 'claude')
  const cands = new Map<string, any>()
  const g = claudePane(snap.focused_pane_id); if (g) cands.set(g.pane_id, g)
  const label = workspaceFromTitle(title)
  if (label) {
    const pick = pickHerdrPane(snap, label)
    if (!('error' in pick)) { const t = claudePane(pick.pane_id); if (t) cands.set(t.pane_id, t) }
  }
  if (!cands.size) { log(`herdr ${machine}: no Claude pane among global focus / title "${title}"`); return null }
  // Even a single candidate must appear on screen.
  const screen = run(KITTEN(), ['@', '--to', kittyTo, 'get-text', '--match', `id:${kittyWindow}`], 3000) ?? ''
  const texts = [...cands.keys()].map(pane => ({
    pane,
    text: run(HERDR(), ['--machine', machine, 'pane', 'read', pane, '--source', 'recent', '--lines', '30'], 5000) ?? '',
  }))
  const chosen = pickByScreen(screen, texts)
  log(`herdr ${machine}: candidates ${[...cands.keys()].join(', ')} (global ${snap.focused_pane_id}, title "${title}") -> ${chosen ?? 'none on screen'}`)
  if (!chosen) return null
  herdrBlocked = cands.get(chosen).agent_status === 'blocked'
  return chosen
}

function typeIntoSession(t: Target, text: string): boolean {
  if (t.herdrPane) {
    const args = [...(t.machine ? ['--machine', t.machine] : []), 'agent', 'prompt', t.herdrPane, text]
    const r = spawnSync(HERDR(), args, { encoding: 'utf8', timeout: 8000 })
    try { const j = JSON.parse(r.stdout); if (j.error) { log(`herdr prompt ${t.herdrPane}: ${j.error.code}`); return false } } catch {}
    return r.status === 0
  }
  const send = (x: string) => spawnSync(KITTEN(), ['@', '--to', t.to, 'send-text', '--match', `id:${t.window}`, '--', x], { timeout: 3000 }).status === 0
  return send(text) && send('\r')
}

// Echo guard and the latency clock both watch the voice server.
let assistantSpeaking = false
let lastSpokeAt = 0
let waiting: { voicedEndAt: number; injectedAt: number; text: string } | null = null
async function pollSpeaking() {
  try {
    const j = await getSpeaking()
    if (j.speaking) {
      lastSpokeAt = Date.now()
      if (!assistantSpeaking && waiting) {
        const first_voice_ms = Date.now() - waiting.voicedEndAt
        appendFileSync(METRICS, JSON.stringify({ at: new Date().toISOString(), first_voice_ms, typed_after_ms: waiting.injectedAt - waiting.voicedEndAt, said: waiting.text.slice(0, 80) }) + '\n')
        log(`first voice ${first_voice_ms}ms after you stopped talking`)
        waiting = null
      }
    } else if (j.last_end > lastSpokeAt) lastSpokeAt = j.last_end
    assistantSpeaking = j.speaking
  } catch {}
}

const whisper = new WhisperServer(undefined, undefined, 6, log)
let voiceprint: VoicePrint | null = null
try {
  voiceprint = new VoicePrint()
  log(voiceprint.enrolled ? `voice print loaded (threshold ${voiceprint.threshold})` : `no voice print enrolled: anyone saying "${WAKE}" gets through (run scripts/enroll.ts)`)
} catch (e: any) { log(`voice print unavailable: ${e?.message ?? e}`) }

// Only the opening is checked for the wake word. A long stretch of TV or other
// people used to cost 16-18 s of whisper and queue the user behind it.
const WAKE_CHECK_SAMPLES = 16000 * 2.5
const STALE_MS = 10000

// Word corrections (Omarchy, Hyprland, ... plus the user's own list), applied
// after transcription and before the wake word check. Reloaded when the file
// changes, so `nixfredos-voice words add` works without a restart.
let corrector = new Corrector()
let vocabStamp = ''
function correct(text: string): string {
  try {
    const st = statSync(PATHS.vocabulary)
    const stamp = `${st.mtimeMs}:${st.size}`
    if (stamp !== vocabStamp) {
      vocabStamp = stamp
      corrector = new Corrector(JSON.parse(readFileSync(PATHS.vocabulary, 'utf8')))
      log(`vocabulary loaded (${PATHS.vocabulary})`)
    }
  } catch (e: any) {
    if (vocabStamp !== 'none' && e?.code !== 'ENOENT') log(`vocabulary unreadable, using built-ins: ${e?.message ?? e}`)
    if (vocabStamp !== 'none') { corrector = new Corrector(); vocabStamp = 'none' }
  }
  return corrector.apply(text)
}

async function onUtterance(u: Utterance) {
  if (lastSpokeAt >= u.startedAt - 400) { log(`echo guard: dropped ${((u.endedAt - u.startedAt) / 1000).toFixed(1)}s heard while the assistant spoke`); return }
  // Only the enrolled user. Runs before whisper, so the TV and other people
  // cost ~50 ms, not a transcription.
  const fromOwnerVad = (u as OwnerUtterance).ownerScore !== undefined
  if (fromOwnerVad) log(`your voice ${(u as OwnerUtterance).ownerScore.toFixed(2)} (personal VAD, ${(u.pcm.length / 16000).toFixed(1)}s)`)
  if (voiceprint?.enrolled && !fromOwnerVad) {
    const v0 = Date.now()
    const score = voiceprint.score(u.pcm)
    if (score < voiceprint.threshold) { log(`not you (voice ${score.toFixed(2)} < ${voiceprint.threshold}, ${Date.now() - v0}ms), ignored ${(u.pcm.length / 16000).toFixed(1)}s`); return }
    log(`your voice ${score.toFixed(2)} (${Date.now() - v0}ms)`)
  }
  const t0 = Date.now()
  let text = ''
  try {
    if (u.pcm.length > WAKE_CHECK_SAMPLES * 1.4) {
      const head = correct(await whisper.transcribe(pcmToWav(u.pcm.subarray(0, WAKE_CHECK_SAMPLES))))
      if (!checkWakeWord(head, { name: WAKE, loose: fromOwnerVad }).ok) { log(`no "${WAKE}" in the opening, ignored ${(u.pcm.length / 16000).toFixed(1)}s (${Date.now() - t0}ms): "${head.slice(0, 60)}"`); return }
    }
    text = correct(await whisper.transcribe(pcmToWav(u.pcm)))
  } catch (e: any) { log(`whisper failed: ${e?.message ?? e}`); return }
  const sttMs = Date.now() - t0
  if (isNoiseTranscript(text)) return
  const wake = checkWakeWord(text, { name: WAKE, loose: fromOwnerVad })
  if (!wake.ok) { log(`no "${WAKE}", ignored (${sttMs}ms): "${text.slice(0, 80)}"`); return }
  // An answer 30 s late is a miss. If the words took over 10 s to get through
  // whisper, say so instead of answering late.
  const lateMs = Date.now() - u.voicedEndAt
  if (lateMs > STALE_MS) {
    log(`too late (${lateMs}ms after you stopped), not typed: "${wake.rest}"`)
    say('Sorry, I missed that. Say it again.')
    return
  }
  const words = wake.rest || `${WAKE}?`
  const target = resolveTarget()
  if (!target) {
    log(`no single Claude window to type into; typed nothing: "${words}"`)
    say('Which session? Click into the one you want, then say it again.')
    return
  }
  if (target.herdrPane && herdrBlocked) {
    log(`herdr pane ${target.herdrPane} is waiting on a question; typed nothing: "${words}"`)
    say('That session is waiting on a question on screen. Answer it first.')
    return
  }
  if (!typeIntoSession(target, `🎙️ ${words}`)) { log(`typing failed (${target.herdrPane ? 'herdr ' + target.herdrPane : 'kitty'}): "${words}"`); return }
  lastTarget = target
  waiting = { voicedEndAt: u.voicedEndAt, injectedAt: Date.now(), text: words }
  log(`typed into ${target.herdrPane ? 'herdr ' + (target.machine ? target.machine + ':' : '') + target.herdrPane : target.to.split('-').pop() + '/' + target.window} (end-of-turn ${u.endedAt - u.voicedEndAt}ms, stt ${sttMs}ms): "${words}"`)
}

let mic: Mic | null = null
function shutdown() { mic?.stop(); whisper.stop(); log('listener off'); process.exit(0) }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await whisper.start()
// Every 10 s of scored sound: how many windows, and the best score. That is the
// tuning data (TV alone vs you over TV) for startScore/keepScore.
let winCount = 0, winBest = -1, winAbove = 0, statsAt = Date.now()
function trackScore(score: number): number {
  winCount++; if (score > winBest) winBest = score; if (score >= 0.42) winAbove++
  if (Date.now() - statsAt >= 10000) {
    if (winCount) log(`windows ${winCount}, best ${winBest.toFixed(2)}, user-like ${winAbove}`)
    winCount = 0; winBest = -1; winAbove = 0; statsAt = Date.now()
  }
  return score
}

// With a voice print, segment by the user's voice (TV never goes quiet);
// without one, fall back to the energy VAD.
const vad: { push(f: Int16Array, now: number): Utterance | null; abort(): void } =
  voiceprint?.enrolled ? new OwnerVad(pcm => trackScore(voiceprint!.score(pcm))) : new EnergyVad()
log(`segmenting by ${voiceprint?.enrolled ? 'your voice (personal VAD)' : 'loudness (energy VAD)'}; platform ${OS}${OS === 'darwin' ? ' (EXPERIMENTAL)' : ''}`)
setInterval(pollSpeaking, 200)
// The switch is re-read every 5 s: turning voice.json "enabled" off stops the mic.
setInterval(() => { if (!loadSwitch().allowed) { log('voice.json no longer says "enabled": true'); shutdown() } }, 5000)
mic = new Mic((frame, now) => {
  // Half-duplex per frame: while the assistant talks (and 400 ms after), the
  // mic is ignored, so your next words start a fresh utterance instead of being
  // glued to the assistant's voice and dropped whole.
  if (assistantSpeaking || now - lastSpokeAt < 400) { vad.abort(); return }
  const u = vad.push(frame, now)
  if (u) onUtterance(u).catch(e => log(`utterance error: ${e?.message ?? e}`))
}, log)
mic.start()
log(`listening for "${WAKE}" -> the focused Claude window (fallback: the only one, then the last used${lastTarget ? ': ' + lastTarget.to + ' #' + lastTarget.window : ''})`)

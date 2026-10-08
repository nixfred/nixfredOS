/**
 * nixfredOS Pulse — Voice Module
 *
 * One speaker, many callers. Linux and macOS. ElevenLabs is optional: the
 * module falls back to OS-native engines when there is no key.
 *
 * Engine order (engine "auto"; force one with voice.json "engine"):
 *   elevenlabs  ELEVENLABS_API_KEY + a voice id. Best quality, paid, cloud.
 *   say         macOS built in.
 *   piper       local neural TTS: `piper` on PATH plus voice.json "piper_model".
 *   espeak      espeak-ng. Robotic, but everywhere.
 *   none        log and stay silent.
 *
 * Switch: ~/.claude/voice.json {"enabled": bool, ...}. Read on EVERY line.
 * Missing or invalid means OFF (fail closed). NIXFREDOS_VOICE=off also means OFF.
 * See NIXFREDOS/VOICE/README.md for the full config contract.
 *
 * Does NOT create its own HTTP server. Exports handleVoiceRequest() for
 * pulse.ts to call on matching routes. Every external program is spawned with
 * an argument array, never a shell string.
 */

import { spawn, spawnSync } from "child_process"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { homedir, hostname, platform, tmpdir } from "os"
import { join } from "path"
import { log } from "../lib"

// ── Public Config Interface ──

export interface VoiceConfig {
  enabled: boolean
  pronunciations_path?: string
}

// ── State ──

const HOME = homedir()
const CONFIG_ROOT = join(HOME, ".claude")
const SWITCH = join(CONFIG_ROOT, "voice.json")
const IS_MAC = platform() === "darwin"
const MAX_SPOKEN_CHARS = 1000

let moduleConfig: VoiceConfig = { enabled: false }
let pronunciations: Array<{ regex: RegExp; spoken: string }> = []

// ── Switch and config ──

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf-8")) } catch { return {} }
}

/** voice.json, re-read on every use so `nixfredos-voice on|off` takes effect at once. */
function cfg(): any {
  const c = readJson(SWITCH)
  return c && typeof c === "object" ? c : {}
}

/** Fail closed: only an explicit boolean true turns voice on. */
function voiceOn(): boolean {
  if ((process.env.NIXFREDOS_VOICE || "").toLowerCase() === "off") return false
  return cfg().enabled === true
}

/** KEY=value lookup: process env, then <configRoot>/.env, then ~/.env. */
function envKey(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  for (const file of [join(CONFIG_ROOT, ".env"), join(HOME, ".env")]) {
    try {
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        const i = line.indexOf("=")
        if (i > 0 && line.slice(0, i).replace(/^export\s+/, "").trim() === name) {
          const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "")
          if (v) return v
        }
      }
    } catch { /* next file */ }
  }
  return undefined
}

/** ElevenLabs voice id: voice.json, else the assistant identity in settings.json. */
function defaultVoiceId(): string | undefined {
  const c = cfg()
  if (typeof c.elevenlabs_voice_id === "string" && c.elevenlabs_voice_id) return c.elevenlabs_voice_id
  const main = readJson(join(CONFIG_ROOT, "settings.json"))?.daidentity?.voices?.main
  const id = main?.voiceId || main?.VOICE_ID || main?.voice_id
  return typeof id === "string" && id ? id : undefined
}

function has(bin: string): boolean {
  return spawnSync(IS_MAC ? "/usr/bin/which" : "which", [bin], { stdio: "ignore" }).status === 0
}

export type Engine = "elevenlabs" | "say" | "piper" | "espeak" | "none"

function pickEngine(): Engine {
  const c = cfg()
  const ok: Record<Engine, () => boolean> = {
    elevenlabs: () => !!envKey("ELEVENLABS_API_KEY") && !!defaultVoiceId(),
    say: () => IS_MAC,
    piper: () => has("piper") && typeof c.piper_model === "string" && existsSync(c.piper_model),
    espeak: () => has("espeak-ng"),
    none: () => true,
  }
  const want = String(c.engine || "auto")
  if (want !== "auto" && want in ok) return ok[want as Engine]() ? (want as Engine) : "none"
  for (const e of ["elevenlabs", "say", "piper", "espeak"] as Engine[]) if (ok[e]()) return e
  return "none"
}

// ── Text ──

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Optional user map: exact phrase -> spoken text (NIXFREDOS/USER/PRINCIPAL/PRONUNCIATIONS.json). */
function loadPronunciations(customPath?: string): void {
  const path = customPath ?? join(CONFIG_ROOT, "NIXFREDOS", "USER", "PRINCIPAL", "PRONUNCIATIONS.json")
  pronunciations = []
  if (!existsSync(path)) return
  try {
    const flat: Record<string, string> = JSON.parse(readFileSync(path, "utf-8"))
    pronunciations = Object.entries(flat).map(([term, spoken]) => {
      // \b only sits next to a word char; anchor only where the term edge is one.
      const lead = /^\w/.test(term) ? "\\b" : ""
      const tail = /\w$/.test(term) ? "\\b" : ""
      return { regex: new RegExp(`${lead}${escapeRegex(term)}${tail}`, "g"), spoken: String(spoken) }
    })
    log("info", `Voice: loaded ${pronunciations.length} pronunciation rules`)
  } catch (error) {
    log("warn", "Voice: could not load PRONUNCIATIONS.json", { error: String(error) })
  }
}

/** Strip what reads badly out loud, then apply the pronunciation map. */
export function speakable(text: string): string {
  let out = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[*_#>|]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
  for (const rule of pronunciations) out = out.replace(rule.regex, rule.spoken)
  return out.slice(0, MAX_SPOKEN_CHARS)
}

// ── Playback ──

function run(cmd: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [stdin === undefined ? "ignore" : "pipe", "ignore", "ignore"] })
    p.on("error", reject)
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
    if (stdin !== undefined) p.stdin!.end(stdin)
  })
}

async function playFile(file: string, volume: number): Promise<void> {
  if (IS_MAC) return run("/usr/bin/afplay", ["-v", String(volume), file])
  if (has("mpv")) return run("mpv", ["--no-video", "--really-quiet", "--volume-max=150", `--volume=${Math.round(volume * 100)}`, file])
  if (has("ffplay")) return run("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file])
  if (file.endsWith(".wav") && has("paplay")) return run("paplay", [file])
  throw new Error("no audio player found (install mpv)")
}

/** Hand the line to another machine's `nixfredos-voice say`; nothing plays here. */
function forwardToSpeaker(host: string, text: string): Promise<void> {
  // A leading "-" would be read as an ssh option; the allow-list also blocks spaces and shell syntax.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host)) throw new Error("invalid speaker host")
  return run(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, '"$HOME/.claude/NIXFREDOS/VOICE/bin/nixfredos-voice" say --stdin'],
    text,
  )
}

async function speakNow(text: string, voiceId?: string): Promise<void> {
  const c = cfg()
  const speaker = typeof c.speaker === "string" ? c.speaker.trim() : ""
  if (speaker && speaker.toLowerCase() !== hostname().toLowerCase()) return forwardToSpeaker(speaker, text)

  const volume = Number(c.volume ?? 1)
  const engine = pickEngine()
  const tmp = join(tmpdir(), `nixfredos-voice-${process.pid}-${Date.now()}`)
  try {
    switch (engine) {
      case "elevenlabs": {
        const vid = voiceId || defaultVoiceId()!
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": envKey("ELEVENLABS_API_KEY")! },
          body: JSON.stringify({ text, model_id: c.elevenlabs_model || "eleven_turbo_v2_5" }),
          signal: AbortSignal.timeout(20000),
        })
        if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 160)}`)
        writeFileSync(tmp + ".mp3", new Uint8Array(await r.arrayBuffer()))
        return await playFile(tmp + ".mp3", volume)
      }
      case "say":
        return await run("/usr/bin/say", [...(c.say_voice ? ["-v", String(c.say_voice)] : []), "--", text])
      case "piper":
        await run("piper", ["--model", String(c.piper_model), "--output_file", tmp + ".wav"], text)
        return await playFile(tmp + ".wav", volume)
      case "espeak":
        return await run("espeak-ng", ["--", text])
      default:
        log("info", "Voice: no engine available, nothing spoken")
    }
  } finally {
    for (const ext of [".mp3", ".wav"]) try { unlinkSync(tmp + ext) } catch { /* not created */ }
  }
}

// One speaker: every line waits for the one before it.
let queue: Promise<void> = Promise.resolve()
let pending = 0
let lastEnd = 0

function enqueue(text: string, voiceId?: string): Promise<void> {
  pending++
  const job = () =>
    speakNow(text, voiceId)
      .catch((e) => log("warn", `Voice: speech failed: ${e?.message ?? e}`))
      .finally(() => { pending--; lastEnd = Date.now() })
  const next = queue.then(job, job)
  queue = next.catch(() => {})
  return next
}

// ── HTTP ──

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

/** Initialize the voice module. Call once at startup. */
export function startVoice(config: VoiceConfig): void {
  moduleConfig = config
  loadPronunciations(config.pronunciations_path)
  log("info", "Voice module: initialized", { engine: pickEngine(), switch: voiceOn() ? "on" : "off" })
}

/** Health for the voice subsystem. */
export function voiceHealth(): Record<string, unknown> {
  return {
    status: moduleConfig.enabled ? "healthy" : "disabled",
    engine: pickEngine(),
    enabled: voiceOn(),
    platform: platform(),
  }
}

/**
 * Routes:
 *   POST /notify              {message, title?, progress?, voice_id?, voice_enabled?}
 *   POST /notify/personality  plain alias of /notify (old callers)
 *   GET  /speaking            {speaking, pending, last_end}  (polled; never rate limited)
 *   GET  /voice/health        {status, engine, enabled, platform}
 *
 * Returns a Response for matched routes, or null if the route is not ours.
 */
export async function handleVoiceRequest(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url)

  if (req.method === "OPTIONS" && ["/notify", "/notify/personality", "/speaking", "/voice/health"].includes(pathname)) {
    return new Response(null, { headers: CORS_HEADERS, status: 204 })
  }
  if (req.method === "GET" && pathname === "/speaking") {
    return jsonResponse({ speaking: pending > 0, pending, last_end: lastEnd })
  }
  if (req.method === "GET" && pathname === "/voice/health") return jsonResponse(voiceHealth())

  if (req.method !== "POST" || (pathname !== "/notify" && pathname !== "/notify/personality")) return null

  let body: any
  try { body = await req.json() } catch { return jsonResponse({ status: "error", message: "bad json" }, 400) }
  if (!body || typeof body !== "object") return jsonResponse({ status: "error", message: "bad json" }, 400)

  if (body.voice_enabled === false || !voiceOn()) return jsonResponse({ status: "off", message: "voice is OFF" })

  const text = speakable(String(body.message ?? ""))
  if (!text) return jsonResponse({ status: "error", message: "nothing to say" }, 400)
  const voiceId = typeof body.voice_id === "string" && body.voice_id ? body.voice_id : undefined

  log("info", `Voice: speak${body.progress === true ? " (queued)" : ""}: "${text.slice(0, 60)}"`)
  const done = enqueue(text, voiceId)
  if (body.progress !== true) await done
  return jsonResponse({ status: "success", message: body.progress === true ? "Queued" : "Spoken" })
}

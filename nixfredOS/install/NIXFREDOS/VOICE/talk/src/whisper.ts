// whisper.cpp `whisper-server`, kept loaded so each utterance transcribes in a
// fraction of a second. Linux: your package manager's whisper-cpp. macOS
// (EXPERIMENTAL): Homebrew's whisper-cpp.
import { spawn, type ChildProcess } from 'child_process'
import { findWhisperModel, which, whisperModelDirs } from './platform'
import { join } from 'path'
import { existsSync } from 'fs'

const VAD_MODEL = 'ggml-silero-v5.1.2.bin'

export function findVadModel(): string | null {
  for (const dir of whisperModelDirs()) {
    const p = join(dir, VAD_MODEL)
    if (existsSync(p)) return p
  }
  return null
}

export class WhisperServer {
  private proc: ChildProcess | null = null
  readonly url: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(readonly port = Number(process.env.NIXFREDOS_WHISPER_PORT || 8791), readonly model = findWhisperModel(),
              readonly threads = 6, private log: (m: string) => void = () => {}) {
    this.url = `http://127.0.0.1:${port}`
  }

  async start(timeoutMs = 20000): Promise<void> {
    if (!this.model) throw new Error('no whisper model found (run scripts/setup.ts)')
    const bin = which('whisper-server')
    if (!bin) throw new Error('whisper-server not found (run scripts/setup.ts for install hints)')
    // No --vad by default: on a short utterance Silero trimmed the soft wake
    // word itself. The energy VAD, wake word and noise filter cover it instead.
    const vad = process.env.NIXFREDOS_VOICE_SILERO === '1' ? findVadModel() : null
    // -nf: no temperature fallback, which bounds the decode time on noisy audio.
    const args = ['-m', this.model, '--host', '127.0.0.1', '--port', String(this.port), '-t', String(this.threads), '-nf']
    if (vad) args.push('--vad', '-vm', vad)
    this.proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.proc.on('exit', code => this.log(`whisper-server exited ${code}`))
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      try { if ((await fetch(this.url + '/')).ok) { this.log(`whisper-server up (${this.model}${vad ? ', silero vad' : ''})`); return } } catch {}
      await Bun.sleep(250)
    }
    throw new Error('whisper-server did not come up')
  }

  /** Transcribe one WAV. Calls are serialized: one model, one job at a time. */
  transcribe(wav: Uint8Array): Promise<string> {
    const job = this.chain.then(async () => {
      const form = new FormData()
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utt.wav')
      form.append('temperature', '0')
      form.append('response_format', 'json')
      const res = await fetch(this.url + '/inference', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`whisper-server ${res.status}`)
      const j = await res.json() as { text?: string }
      return (j.text ?? '').replace(/\s+/g, ' ').trim()
    })
    this.chain = job.catch(() => {})
    return job
  }

  stop() { try { this.proc?.kill('SIGTERM') } catch {} this.proc = null }
}

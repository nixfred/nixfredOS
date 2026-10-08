// Live mic, cut into 30 ms frames of 16 kHz mono s16le.
//   Linux (supported): pw-record, pointed at the default source by name.
//   macOS (EXPERIMENTAL, untested): ffmpeg -f avfoundation -i ":0".
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { FRAME_BYTES } from './ears'
import { OS, which } from './platform'

// Without --target, WirePlumber restores a remembered per-app link, which can
// be a silent secondary mic (one laptop read -89 dBFS on Mic2 while the default
// Mic1 read -39 dBFS). So always name the default source explicitly.
export function defaultSource(): string | undefined {
  const pactl = which('pactl')
  if (!pactl) return undefined
  const r = spawnSync(pactl, ['get-default-source'], { encoding: 'utf8', timeout: 3000 })
  const name = (r.stdout || '').trim()
  return r.status === 0 && name ? name : undefined
}

/** argv for the recorder that streams raw 16 kHz mono s16le to stdout. */
export function recorderCommand(target?: string): { bin: string; args: string[]; label: string } | null {
  if (OS === 'darwin') {
    const bin = which('ffmpeg')
    if (!bin) return null
    // EXPERIMENTAL: ":0" is the first audio input device. List them with
    // `ffmpeg -f avfoundation -list_devices true -i ""`; NIXFREDOS_MIC=":1" overrides.
    const dev = process.env.NIXFREDOS_MIC || ':0'
    return { bin, args: ['-loglevel', 'error', '-f', 'avfoundation', '-i', dev, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], label: `ffmpeg avfoundation ${dev} (EXPERIMENTAL)` }
  }
  const bin = which('pw-record')
  if (!bin) return null
  const args = ['--rate', '16000', '--channels', '1', '--format', 's16', '--raw']
  if (target) args.push('--target', target)
  args.push('-')
  return { bin, args, label: `pw-record --target ${target ?? 'NONE: WirePlumber picks, may be the wrong mic'}` }
}

export class Mic {
  private proc: ChildProcess | null = null
  private rest = Buffer.alloc(0)

  constructor(private onFrame: (frame: Int16Array, now: number) => void,
              private log: (m: string) => void = () => {},
              private target?: string) {}

  start() {
    if (OS === 'linux') this.target ??= defaultSource()
    const cmd = recorderCommand(this.target)
    if (!cmd) throw new Error(OS === 'darwin' ? 'ffmpeg not found (brew install ffmpeg)' : 'pw-record not found (install pipewire)')
    this.proc = spawn(cmd.bin, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      let buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk
      const now = Date.now()
      while (buf.length >= FRAME_BYTES) {
        // Copy each frame into its own aligned buffer (Int16Array needs even offsets).
        const frame = new Int16Array(new Uint8Array(buf.subarray(0, FRAME_BYTES)).buffer)
        buf = buf.subarray(FRAME_BYTES)
        this.onFrame(frame, now)
      }
      this.rest = Buffer.from(buf)
    })
    this.proc.stderr!.on('data', (d: Buffer) => this.log(`recorder: ${d.toString().trim().slice(0, 200)}`))
    this.proc.on('exit', code => this.log(`recorder exited ${code}`))
    this.log(`mic on (${cmd.label})`)
  }

  stop() { try { this.proc?.kill('SIGTERM') } catch {} this.proc = null }
}

/** Record for a fixed time (used by enrollment). Returns 16 kHz mono samples. */
export function recordSeconds(seconds: number, target?: string): Int16Array {
  if (OS === 'linux') target ??= defaultSource()
  const cmd = recorderCommand(target)
  if (!cmd) throw new Error('no recorder found (pw-record on Linux, ffmpeg on macOS)')
  // spawnSync's timeout kills the recorder and still hands back what it wrote.
  const r = spawnSync(cmd.bin, cmd.args, { timeout: seconds * 1000, maxBuffer: 64 << 20 })
  const b = r.stdout as Buffer
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~1)))
}

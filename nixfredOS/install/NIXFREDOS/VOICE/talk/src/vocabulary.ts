// Correct the words whisper reliably mishears (ported from Omavoice's
// vocabulary.py, MIT).
//
// An initial prompt is the usual way to teach whisper a word, but a prompt only
// reaches the decoder through its text context, and text context is what makes
// whisper loop. So vocabulary is fixed AFTER decoding: each term lists the ways
// it actually comes out, and those are rewritten to the term that was meant. A
// term also normalises its own spelling ("github" becomes "GitHub"). Matching is
// whole words only, case-insensitive, never inside a domain, a path or a
// hyphenated word, and the longest match wins so a phrase beats a word inside it.
//
// A variant belongs here only if it is not an ordinary word in its own right:
// "pseudo" is how whisper hears sudo, but people say pseudo; "cloud" is how it
// hears Claude, but people say cloud; "herder" is how it hears herdr, but people
// say herder. Those are left alone on purpose.
//
// Users add their own terms in ~/.config/nixfredos-voice/vocabulary.json:
//   {"Omarchy": ["Amachi"], "MyProject": ["my project"]}
// or with `nixfredos-voice words add <term> <heard as> [...]`.

export type Vocabulary = Record<string, string[]>

export const OMARCHY: Vocabulary = {
  Omarchy: [
    'Omaki', 'Omarchi', 'Omarchie', 'Omarchic', 'Omachi', 'Omachy', 'Omarze',
    'Omarky', 'Omarkey', "O'Marchy", 'O Marchy', 'Amarty', 'Amachi',
    'Oh March he', 'O March he', 'Omar chi', 'Oh Marchy',
  ],
  Hyprland: ['Hyperland', 'Hyper land', 'Hyperlands'],
  Waybar: ['Way bar'],
  Quickshell: [],
}

export const LINUX: Vocabulary = {
  Linux: ['Linox', 'Linucks'],
  'Arch Linux': ['Arch Linox'],
  Ubuntu: ['Ubunto', 'Oobuntu', 'Uboontu'],
  Debian: [],
  NixOS: ['Nix OS', 'Nicks OS'],
  Wayland: ['Way land'],
  PipeWire: ['Pipe wire', 'Pipewire'],
  PulseAudio: ['Pulse audio'],
  systemd: ['System D', 'SystemD'],
  sudo: [],
  pacman: ['Pac-Man', 'Pacman'],
  AUR: ['A U R', 'A.U.R.'],
  tmux: ['T mux', 'Tee mux', 'Teamux'],
  btop: ['B top', 'Bee top'],
  fastfetch: [],
  neofetch: ['Neo fetch'],
  Btrfs: ['Butter FS', 'Butter F S', 'ButterFS'],
  Alacritty: ['Alacrity', 'Alacritie'],
  Ghostty: ['Ghosty'],
  KDE: [],
  Flatpak: [],
}

export const TECH: Vocabulary = {
  'Claude Code': ['Clock code', 'Clawed code', 'Claude code'],
  nixfredOS: ['Nix Fred OS', 'Nixfred OS', 'Nix Fred O S'],
  OSINT: ['OSIT', 'O S I N T'],
  GitHub: ['Git hub', 'Get hub', 'Github'],
  GitLab: ['Git lab', 'Gitlab'],
  Kubernetes: ['Cooper Netties', 'Kuber Nettes', 'Kubernetties', 'Kubernettes'],
  YAML: ['Yamel'],
  Nginx: ['Engine X', 'Engine-X', 'EngineX'],
  Postgres: ['Post Gres', 'Postgress'],
  SQLite: ['Sequel light', 'SQL light', 'Sequel lite'],
  Ollama: ['Olama', 'Olamma'],
  Tailscale: ['Tail scale', 'Tailscail'],
  Cloudflare: ['Cloud flare'],
  Vercel: ['Versel'],
  Neovim: ['Neo vim', 'NeoVim'],
  'VS Code': ['V S Code', 'VSCode', 'VS code'],
  TypeScript: ['Type script', 'Typescript'],
  JavaScript: ['Java script', 'Javascript'],
  npm: ['N P M'],
  API: [],
  CPU: [],
  GPU: [],
  SSD: [],
  SSH: [],
  NVMe: ['N V M E', 'NVME'],
  NVIDIA: [],
  LLM: ['L L M'],
  macOS: ['Mac OS', 'MacOS'],
}

export const DEFAULT_VOCABULARY: Vocabulary = { ...TECH, ...LINUX, ...OMARCHY }

/** Keep only well-formed entries: a non-empty string term mapped to strings. */
export function cleanVocabulary(v: unknown): Vocabulary {
  const out: Vocabulary = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [term, heard] of Object.entries(v as Record<string, unknown>)) {
    if (!term.trim() || !Array.isArray(heard)) continue
    out[term.trim()] = heard.filter((h): h is string => typeof h === 'string' && !!h.trim())
  }
  return out
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class Corrector {
  private replacement = new Map<string, string>()
  private pattern: RegExp | null

  constructor(user: unknown = null, base: Vocabulary = DEFAULT_VOCABULARY) {
    const merged: Vocabulary = {}
    for (const [t, h] of Object.entries(base)) merged[t] = [...h]
    for (const [t, h] of Object.entries(cleanVocabulary(user))) (merged[t] ??= []).push(...h)
    for (const [term, heard] of Object.entries(merged)) {
      // The term itself too, so its spelling is normalised.
      for (const variant of [term, ...heard]) {
        const key = norm(variant)
        if (key) this.replacement.set(key, term)
      }
    }
    // Longest first, so a phrase is rewritten as a whole before a word in it.
    const alts = [...this.replacement.keys()].sort((a, b) => b.length - a.length)
    const body = alts.map(v => v.split(' ').map(escape).join('\\s+')).join('|')
    // Nothing touching either side that would make it part of something bigger:
    // not inside a word, a domain, a path, an email or a hyphenation.
    this.pattern = body ? new RegExp(`(?<![\\w'./@-])(?:${body})(?![\\w'/@-]|\\.\\w)`, 'gi') : null
  }

  apply(text: string): string {
    if (!text || !this.pattern) return text
    return text.replace(this.pattern, m => this.replacement.get(norm(m)) ?? m)
  }
}

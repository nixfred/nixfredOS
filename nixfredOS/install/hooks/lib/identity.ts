/**
 * Central Identity Loader — the one module hooks and tools import for DA
 * (Digital Assistant) and Principal identity.
 *
 * Read order (what the code below actually does): NIXFREDOS_CONFIG.toml FIRST for
 * every field it carries, then the legacy chain for everything else and for
 * installs with no config yet:
 *   - settings.json daidentity/principal runtime mirror
 *   - NIXFREDOS/USER/DIGITAL_ASSISTANT/DA_IDENTITY.md frontmatter
 *   - NIXFREDOS/USER/PRINCIPAL/PRINCIPAL_IDENTITY.md frontmatter
 *
 * The CANONICAL config source is NIXFREDOS/USER/CONFIG/NIXFREDOS_CONFIG.toml (read
 * via NIXFREDOS/TOOLS/nixfredOSConfig.ts); the settings.json mirror exists so hooks
 * resolve identity without parsing markdown on every event.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  loadnixfredOSConfig,
  type nixfredOSDa,
  type nixfredOSPrincipal,
} from '../../NIXFREDOS/TOOLS/nixfredOSConfig';
import { homedir } from "node:os";

// HOME ?? USERPROFILE: Windows defines only the latter (public issue #1694, @dissembler21-png)
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const SETTINGS_PATH = join(HOME, '.claude/settings.json');

// Identity-file paths derive from nixfredOSConfig's userDir. On fresh installs where
// NIXFREDOS_CONFIG.toml hasn't been created yet, fall back to the conventional
// NIXFREDOS/USER/ location so identity loading still bootstraps. Lazy try/catch so
// a malformed nixfredOSConfig never breaks identity bootstrap.
function paiUserDir(): string {
  try {
    return loadnixfredOSConfig().paths.userDir;
  } catch {
    return join(HOME, '.claude/NIXFREDOS/USER');
  }
}
const DA_IDENTITY_PATH = join(paiUserDir(), 'DIGITAL_ASSISTANT/DA_IDENTITY.md');
const PRINCIPAL_IDENTITY_PATH = join(paiUserDir(), 'PRINCIPAL/PRINCIPAL_IDENTITY.md');

const DEFAULT_IDENTITY = {
  name: 'nixfredOS',
  fullName: 'Personal AI',
  displayName: 'nixfredOS',
  mainDAVoiceID: '',
  color: '#3B82F6',
};

const DEFAULT_PRINCIPAL = {
  name: 'User',
  pronunciation: '',
  timezone: 'UTC',
};

/** Optional ElevenLabs tuning kept in the assistant identity. Engines other than ElevenLabs ignore it. */
export interface VoiceProsody {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
  volume?: number;
}

export interface Identity {
  name: string;
  fullName: string;
  displayName: string;
  mainDAVoiceID: string;
  color: string;
  voice?: VoiceProsody;
}

export interface Principal {
  name: string;
  pronunciation: string;
  timezone: string;
}

export interface Settings {
  daidentity?: Partial<Identity>;
  principal?: Partial<Principal>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

let cachedSettings: Settings | null = null;
let cachedDaFm: Record<string, any> | null = null;
let cachedPrincipalFm: Record<string, any> | null = null;

function loadFrontmatter(path: string): Record<string, any> | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    return parseYaml(match[1]) || null;
  } catch {
    return null;
  }
}

function loadDaFrontmatter(): Record<string, any> {
  if (cachedDaFm) return cachedDaFm;
  cachedDaFm = loadFrontmatter(DA_IDENTITY_PATH) ?? {};
  return cachedDaFm;
}

function loadPrincipalFrontmatter(): Record<string, any> {
  if (cachedPrincipalFm) return cachedPrincipalFm;
  cachedPrincipalFm = loadFrontmatter(PRINCIPAL_IDENTITY_PATH) ?? {};
  return cachedPrincipalFm;
}

function loadSettings(): Settings {
  if (cachedSettings) return cachedSettings;
  try {
    if (!existsSync(SETTINGS_PATH)) {
      cachedSettings = {};
      return cachedSettings;
    }
    const content = readFileSync(SETTINGS_PATH, 'utf-8');
    cachedSettings = JSON.parse(content);
    return cachedSettings!;
  } catch {
    cachedSettings = {};
    return cachedSettings;
  }
}

function mapFrontmatterVoice(v: any): VoiceProsody | undefined {
  if (!v) return undefined;
  return {
    stability: v.stability ?? 0,
    similarityBoost: v.similarity_boost ?? v.similarityBoost ?? 0,
    style: v.style ?? 0,
    speed: v.speed ?? 1,
    useSpeakerBoost: v.use_speaker_boost ?? v.useSpeakerBoost ?? false,
    volume: v.volume,
  };
}

/**
 * Get DA (Digital Assistant) identity.
 *
 * NIXFREDOS_CONFIG.toml `[da]` wins for every field it carries. It is the typed
 * loader, it is where setup tells the principal to name their DA, and
 * nixfredOSConfig itself refuses to load without a non-empty `[da].name` — so it
 * is the one source guaranteed to be both present and current.
 *
 * The settings.daidentity → DA_IDENTITY.md frontmatter → DEFAULT_IDENTITY chain
 * below stays the fallback: it covers the fields config does not carry
 * (the ElevenLabs voice id and tuning), and an install that has no config yet
 * resolves exactly as it did before.
 *
 * public PR #1781, @anikinsasha
 */
export function getIdentity(): Identity {
  const base = legacyIdentity();

  let da: nixfredOSDa | undefined;
  try {
    da = loadnixfredOSConfig().da;
  } catch {
    return base; // no config yet (fresh install) — legacy chain governs
  }
  if (!da?.name) return base;

  const main = da.voices?.main;
  return {
    ...base,
    name: da.name,
    fullName: da.fullName || da.name,
    displayName: da.displayName || da.name,
    color: da.color || base.color,
    mainDAVoiceID: main?.voiceId || base.mainDAVoiceID,
    voice: main
      ? {
          stability: main.stability ?? 0,
          similarityBoost: main.similarityBoost ?? 0,
          style: main.style ?? 0,
          speed: main.speed ?? 1,
          useSpeakerBoost: main.useSpeakerBoost ?? false,
          volume: main.volume,
        }
      : base.voice,
  };
}

/**
 * The pre-config resolution chain: settings.daidentity (runtime read point),
 * then DA_IDENTITY.md frontmatter (authoring source), then the placeholder.
 */
function legacyIdentity(): Identity {
  const settings = loadSettings();
  const daidentity = (settings.daidentity || {}) as any;
  const voices = daidentity.voices || {};
  const voiceConfig = voices.main || daidentity.voice;
  const mainVoiceId = voiceConfig?.voiceId || daidentity.voiceId || daidentity.mainDAVoiceID;

  if (daidentity.name || mainVoiceId) {
    const envDA = settings.env?.DA;
    return {
      name: daidentity.name || envDA || DEFAULT_IDENTITY.name,
      fullName: daidentity.fullName || daidentity.name || envDA || DEFAULT_IDENTITY.fullName,
      displayName: daidentity.displayName || daidentity.name || envDA || DEFAULT_IDENTITY.displayName,
      mainDAVoiceID: mainVoiceId || DEFAULT_IDENTITY.mainDAVoiceID,
      color: daidentity.color || DEFAULT_IDENTITY.color,
      voice: voiceConfig as VoiceProsody | undefined,
    };
  }

  // Fallback: DA_IDENTITY.md frontmatter (authoring source)
  const fm = loadDaFrontmatter();
  const core = fm.core ?? {};
  const voice = fm.voice ?? {};
  const mainVoice = voice.main ?? {};
  return {
    name: core.name || DEFAULT_IDENTITY.name,
    fullName: core.full_name || core.name || DEFAULT_IDENTITY.fullName,
    displayName: core.display_name || core.name || DEFAULT_IDENTITY.displayName,
    mainDAVoiceID: mainVoice.voice_id || DEFAULT_IDENTITY.mainDAVoiceID,
    color: core.color || DEFAULT_IDENTITY.color,
    voice: mapFrontmatterVoice(mainVoice),
  };
}

/**
 * Get Principal (human owner) identity.
 *
 * Same contract as getIdentity(): NIXFREDOS_CONFIG.toml `[principal]` wins, and
 * nixfredOSConfig requires a non-empty name and timezone there. The
 * PRINCIPAL_IDENTITY.md frontmatter → settings.principal chain is the fallback.
 *
 * public PR #1781, @anikinsasha
 */
export function getPrincipal(): Principal {
  const base = legacyPrincipal();

  let p: nixfredOSPrincipal | undefined;
  try {
    p = loadnixfredOSConfig().principal;
  } catch {
    return base; // no config yet (fresh install) — legacy chain governs
  }
  if (!p?.name) return base;

  return {
    name: p.name,
    pronunciation: p.pronunciation || base.pronunciation,
    timezone: p.timezone || base.timezone,
  };
}

/** The pre-config chain: PRINCIPAL_IDENTITY.md frontmatter, then settings. */
function legacyPrincipal(): Principal {
  const fm = loadPrincipalFrontmatter();
  const core = fm.core ?? {};

  if (core.name) {
    return {
      name: core.name,
      pronunciation: core.pronunciation || DEFAULT_PRINCIPAL.pronunciation,
      timezone: core.timezone || DEFAULT_PRINCIPAL.timezone,
    };
  }

  // Fallback
  const settings = loadSettings();
  const principal = settings.principal || {};
  const envPrincipal = settings.env?.PRINCIPAL;
  return {
    name: principal.name || envPrincipal || DEFAULT_PRINCIPAL.name,
    pronunciation: principal.pronunciation || DEFAULT_PRINCIPAL.pronunciation,
    timezone: principal.timezone || DEFAULT_PRINCIPAL.timezone,
  };
}

/**
 * Clear cache (useful for testing or when source files change)
 */
export function clearCache(): void {
  cachedSettings = null;
  cachedDaFm = null;
  cachedPrincipalFm = null;
}

export function getDAName(): string {
  return getIdentity().name;
}

/**
 * Startup catchphrase. Reads settings.daidentity.startupCatchphrase first (canonical),
 * falls back to DA_IDENTITY.md frontmatter core.startup_catchphrase (authoring source).
 * Substitutes `{name}` with the DA name.
 */
export function getStartupCatchphrase(): string {
  const settings = loadSettings();
  const fromSettings = (settings.daidentity as any)?.startupCatchphrase as string | undefined;
  const fm = loadDaFrontmatter();
  const fromFm = fm.core?.startup_catchphrase as string | undefined;
  const name = getDAName();
  const template = (fromSettings && fromSettings.trim()) || (fromFm && fromFm.trim()) || '{name} here, ready to go.';
  return template.replace(/\{name\}/gi, name);
}

export function getPrincipalName(): string {
  return getPrincipal().name;
}

export function getVoiceId(): string {
  return getIdentity().mainDAVoiceID;
}

export function getSettings(): Settings {
  return loadSettings();
}

export function getDefaultIdentity(): Identity {
  return { ...DEFAULT_IDENTITY };
}

export function getDefaultPrincipal(): Principal {
  return { ...DEFAULT_PRINCIPAL };
}

export function getVoiceProsody(): VoiceProsody | undefined {
  return getIdentity().voice;
}

/**
 * Read principal preferences (e.g. temperature_unit) from frontmatter.
 */
export function getPrincipalPreferences(): Record<string, any> {
  return loadPrincipalFrontmatter().preferences ?? {};
}

/**
 * Read principal tech_stack from frontmatter.
 */
export function getTechStack(): Record<string, any> {
  return loadPrincipalFrontmatter().tech_stack ?? {};
}

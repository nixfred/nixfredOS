#!/usr/bin/env bun
/**
 * nixfredOSConfig.ts — typed user-config loader.
 *
 * The INTERFACE between SYSTEM code (this file ships in every nixfredOS release) and
 * USER data (the actual values, sourced from NIXFREDOS/USER/CONFIG/NIXFREDOS_CONFIG.toml).
 *
 * Doctrine: system code reads identity, voice IDs, integration credentials,
 * and path roots through `loadnixfredOSConfig()`. No system file directly opens
 * any file under NIXFREDOS/USER/ for these values — the path-rooting happens here.
 *
 * Format decision (ISC-56.1): TOML.
 *   - Zero new dependencies (Bun 1.3+ native TOML via require()).
 *   - Human-editable with sections, comments, multi-line strings.
 *   - PULSE.user.toml already in user-config dir as precedent.
 *
 * See: NIXFREDOS/DOCUMENTATION/SystemUserBoundary.md § "The four allowed access patterns".
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// Expand leading `~` (and `~/`) to the user's home directory. node:fs APIs do
// not expand tildes, so any path returned from this loader must be absolute.
function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return DEFAULT_HOME;
  if (p.startsWith("~/")) return resolve(DEFAULT_HOME, p.slice(2));
  return p;
}

// ─────────── Types ───────────

export interface nixfredOSPrincipal {
  name: string;
  pronunciation?: string;
  timezone: string;
  hometown?: string;
  voiceCloneId?: string;
  // ISO 4217 code (e.g. "JPY", "EUR"). Optional — consumers (currently just
  // Pulse's Finances tab) default to "USD" when unset, so existing TOML files
  // need no edit.
  // ported from public PR #1777, @takanorinishida
  currency?: string;
}

export interface nixfredOSVoiceSettings {
  voiceId: string;
  voiceName?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  useSpeakerBoost?: boolean;
  volume?: number;
}

export interface nixfredOSDa {
  name: string;
  fullName?: string;
  displayName?: string;
  color?: string;
  voices: {
    main: nixfredOSVoiceSettings;
  };
}

export interface nixfredOSIntegrations {
  google?: { credentialsFile?: string };
  cloudflare?: { accountId?: string; tokenEnvVar?: string };
  [key: string]: unknown;
}

export interface nixfredOSPaths {
  userDir: string;
  // memoryDir was removed 2026-07-18 (public issue #1526, @christauff): declared
  // since inception but never consumed — the memory root is derived by
  // hooks/lib/paths.ts getMemoryDir(), and a dead config knob that LOOKS live
  // is worse than no knob.
  projectsDir: string;
}

export interface nixfredOSConfig {
  principal: nixfredOSPrincipal;
  da: nixfredOSDa;
  integrations: nixfredOSIntegrations;
  paths: nixfredOSPaths;
}

// ─────────── Resolution ───────────

const DEFAULT_HOME = process.env.HOME || homedir();
const DEFAULT_CONFIG_PATH = resolve(DEFAULT_HOME, ".claude/NIXFREDOS/USER/CONFIG/NIXFREDOS_CONFIG.toml");

let cache: { config: nixfredOSConfig; mtime: number; path: string } | null = null;

export function loadnixfredOSConfig(opts: { path?: string; force?: boolean } = {}): nixfredOSConfig {
  const path = opts.path ?? process.env.NIXFREDOS_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

  if (!existsSync(path)) {
    throw new Error(
      `nixfredOSConfig: config file not found at ${path}. ` +
        `Create it (see NIXFREDOS/USER/CONFIG/README.md) or set NIXFREDOS_CONFIG_PATH.`,
    );
  }

  const mtime = statSync(path).mtimeMs;
  if (!opts.force && cache && cache.path === path && cache.mtime === mtime) {
    return cache.config;
  }

  // Invalidate Bun's require cache so re-reads pick up mtime changes.
  try {
    const resolved = require.resolve(path);
    delete require.cache[resolved];
  } catch {
    // require.resolve can throw on first read; safe to ignore.
  }

  // Bun 1.3+ parses TOML via require() at any path ending in .toml.
  const raw = require(path) as unknown;
  const validated = validateAndNormalize(raw, path);
  cache = { config: validated, mtime, path };
  return validated;
}

export function clearnixfredOSConfigCache(): void {
  cache = null;
}

/**
 * Convenience helper for the most common consumer pattern: "give me the user
 * directory, fall back to the conventional location on fresh installs."
 * Used by Banner tools, HealthSnapshot, hooks/lib/identity, and any other
 * system module that needs to compose paths under the user zone.
 */
export function paiUserDir(): string {
  try {
    return loadnixfredOSConfig().paths.userDir;
  } catch {
    return resolve(DEFAULT_HOME, ".claude/NIXFREDOS/USER");
  }
}

// ─────────── Validation ───────────

function validateAndNormalize(raw: unknown, path: string): nixfredOSConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`nixfredOSConfig: ${path} did not parse to an object`);
  }
  const root = raw as Record<string, any>;

  const principal = root.principal ?? {};
  if (typeof principal.name !== "string" || !principal.name) {
    throw new Error(`nixfredOSConfig: [principal] requires a non-empty name — see ${path}`);
  }
  if (typeof principal.timezone !== "string" || !principal.timezone) {
    throw new Error(`nixfredOSConfig: [principal] requires a non-empty timezone — see ${path}`);
  }

  const da = root.da ?? {};
  if (typeof da.name !== "string" || !da.name) {
    throw new Error(`nixfredOSConfig: [da] requires a non-empty name — see ${path}`);
  }
  const daVoices = da.voices ?? {};
  if (!daVoices.main || typeof (daVoices.main.voice_id ?? daVoices.main.voiceId) !== "string") {
    throw new Error(`nixfredOSConfig: [da.voices.main] requires a voice_id — see ${path}`);
  }

  return {
    principal: {
      name: principal.name,
      pronunciation: principal.pronunciation,
      timezone: principal.timezone,
      hometown: principal.hometown,
      voiceCloneId: principal.voice_clone_id ?? principal.voiceCloneId,
      currency: principal.currency,
    },
    da: {
      name: da.name,
      fullName: da.full_name ?? da.fullName,
      displayName: da.display_name ?? da.displayName,
      color: da.color,
      voices: {
        main: normalizeVoice(daVoices.main),
      },
    },
    integrations: {
      ...root.integrations,
      // Normalize snake_case TOML keys like the principal/da fields above. The
      // spread stays FIRST — spreading after would clobber the normalized shape
      // with the raw TOML object (credentials_file vs credentialsFile).
      google: root.integrations?.google
        ? {
            ...root.integrations.google,
            credentialsFile:
              root.integrations.google.credentials_file ?? root.integrations.google.credentialsFile,
          }
        : undefined,
      cloudflare: root.integrations?.cloudflare,
    },
    paths: {
      userDir: expandHome(
        root.paths?.userDir ?? root.paths?.user_dir ?? resolve(DEFAULT_HOME, ".claude/NIXFREDOS/USER"),
      ),
      projectsDir: expandHome(
        root.paths?.projectsDir ?? root.paths?.projects_dir ?? resolve(DEFAULT_HOME, "Projects"),
      ),
    },
  };
}

function normalizeVoice(v: any): nixfredOSVoiceSettings {
  return {
    voiceId: v.voice_id ?? v.voiceId,
    voiceName: v.voice_name ?? v.voiceName,
    stability: v.stability,
    similarityBoost: v.similarity_boost ?? v.similarityBoost,
    style: v.style,
    speed: v.speed,
    useSpeakerBoost: v.use_speaker_boost ?? v.useSpeakerBoost,
    volume: v.volume,
  };
}

// ─────────── CLI entry ───────────

if (import.meta.main) {
  try {
    const cfg = loadnixfredOSConfig();
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

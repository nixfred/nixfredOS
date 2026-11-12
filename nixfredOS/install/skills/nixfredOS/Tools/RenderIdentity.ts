#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in NIXFREDOS_DIR/NIXFREDOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["NIXFREDOS_DIR", "NIXFREDOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? homedir());
}

/**
 * RenderIdentity — Setup step 9(d) as a command. Writes the AI's name and the human's name (and the nixfredOS
 * version) into the deployed tree: every {{DA_NAME}}, {{DA_FULL_NAME}}, {{PRINCIPAL_NAME}}, {{PRINCIPAL_FULL_NAME}}
 * and {{NIXFREDOS_VERSION}} on the model-facing surfaces (hooks, commands, agents, the ALGORITHM, the system
 * prompt, CLAUDE.md, settings.json), then proves none survive.
 *
 * Why it exists: the by-hand Core path (DeployCore, ScaffoldUser, LinkUser, InstallHooks) never ran step 9(d),
 * so Doctor showed "Identity placeholders rendered: broken" on a fresh install, with the raw tokens still in the
 * hooks. Two traps made the hand-rolled fix easy to get wrong, both closed here: a whole-tree substituteTree
 * rewrites the engine's own IDENTITY_PLACEHOLDERS list (the check then can never pass), and substituteTree
 * silently skips any key that is not a braced {{UPPER_CASE}} token.
 *
 * Safe by construction:
 *   - Dry run by default (like its siblings): reports what would change, writes nothing.
 *   - --apply copies every file it is about to change into <configRoot>/backups/render-identity-<stamp>/ first.
 *   - Roots come from InstallEngine.identityRoots(), the same list Doctor checks. It never touches
 *     skills/nixfredOS/Tools or the install/ payload (they hold the tokens legitimately).
 *   - Idempotent: a second run finds nothing to render and exits 0.
 *   - Names are validated: a quote, backslash or apostrophe would break the JSON and TypeScript strings the
 *     tokens sit in, so they are refused up front, never half-written.
 *   - settings.json must still parse after the render, or the original is put back.
 *   - Refuses on a nixfredOS source tree (dev-tree marker) unless --allow-dev.
 *
 * Usage:
 *   bun RenderIdentity.ts --da <AI name> --principal <human first name>
 *                         [--da-full <name>] [--principal-full <name>] [--config-root <dir>] [--apply] [--allow-dev]
 */

import { join, relative, resolve, dirname } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { checkSurvivingPlaceholders, detectDevTree, identityRoots, substituteTree } from "./InstallEngine";

/** A letter or digit first, then letters, digits, space, dot, hyphen or underscore. No quotes, backslashes, braces or newlines. */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,47}$/u;

type Site = { file: string; placeholder: string; count: number };

function out(obj: unknown, code: number): never {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

function main(): void {
  const a = process.argv.slice(2);
  const get = (f: string): string | undefined => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
  };
  const home = process.env.HOME || homedir();
  const configRoot = resolve(get("--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"));
  const nixfredosDir = (process.env.NIXFREDOS_DIR || join(configRoot, "NIXFREDOS"))
    .replace(/^\$HOME/, home).replace(/^~(?=\/)/, home);
  const apply = a.includes("--apply");
  const allowDev = a.includes("--allow-dev");

  const da = get("--da");
  const principal = get("--principal");
  const daFull = get("--da-full") ?? da;
  const principalFull = get("--principal-full") ?? principal;

  if (!da || !principal) {
    out({
      ok: false,
      error: "missing --da and/or --principal",
      usage: 'bun RenderIdentity.ts --da "<AI name>" --principal "<human first name>" [--apply]',
    }, 2);
  }
  for (const [flag, value] of [["--da", da], ["--principal", principal], ["--da-full", daFull], ["--principal-full", principalFull]] as const) {
    if (!value || !NAME_RE.test(value)) {
      out({
        ok: false,
        error: `${flag} ${JSON.stringify(value)} is not usable as a name`,
        detail: "Use 1 to 48 characters: letters, digits, spaces, dots, hyphens or underscores, starting with a letter or digit. Quotes, apostrophes, backslashes and braces would break the JSON and TypeScript strings the name is written into; pick a spelling without them.",
      }, 2);
    }
  }
  if (!existsSync(configRoot)) out({ ok: false, error: `config root not found: ${configRoot}` }, 2);
  if (detectDevTree(configRoot) && !allowDev) {
    out({
      ok: false,
      refused: "dev-tree",
      detail: `${configRoot} is a nixfredOS source tree (dev-tree marker present) — refusing to render identity into templates that must stay generic. Use --allow-dev only in a sandbox.`,
    }, 2);
  }

  // The vars substituteTree may fill. Keys must be braced {{UPPER_CASE}} tokens or substituteTree skips them silently.
  const vars: Record<string, string> = {
    "{{DA_NAME}}": da!,
    "{{DA_FULL_NAME}}": daFull!,
    "{{PRINCIPAL_NAME}}": principal!,
    "{{PRINCIPAL_FULL_NAME}}": principalFull!,
  };
  const versionFile = join(nixfredosDir, "VERSION");
  let versionNote: string | undefined;
  if (existsSync(versionFile)) {
    const version = readFileSync(versionFile, "utf-8").trim();
    if (/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) vars["{{NIXFREDOS_VERSION}}"] = version;
    else versionNote = `${versionFile} does not hold a plain version string; {{NIXFREDOS_VERSION}} left alone`;
  } else {
    versionNote = `${versionFile} not found; {{NIXFREDOS_VERSION}} left alone`;
  }

  const roots = identityRoots(configRoot, nixfredosDir);
  const scan = (): Site[] => roots.flatMap((r) => checkSurvivingPlaceholders(r).files);
  const mine = (s: Site): boolean => s.placeholder in vars;

  const before = scan();
  const pending = before.filter(mine);
  const others = before.filter((s) => !mine(s));
  const pendingFiles = [...new Set(pending.map((s) => s.file))];
  const tokenCount = pending.reduce((n, s) => n + s.count, 0);
  const rel = (f: string): string => relative(configRoot, f);
  // Voice ids and any token this command does not own are reported, never silently ignored.
  const otherNote = others.length
    ? { notRenderedByThisCommand: others.slice(0, 10).map((s) => `${s.placeholder} x${s.count} in ${rel(s.file)}`), count: others.reduce((n, s) => n + s.count, 0) }
    : undefined;

  const base = { configRoot, names: { ai: da, human: principal }, version: vars["{{NIXFREDOS_VERSION}}"], versionNote };

  if (!apply) {
    out({
      ok: true,
      dryRun: true,
      ...base,
      filesToChange: pendingFiles.length,
      tokensToRender: tokenCount,
      sample: pending.slice(0, 8).map((s) => `${s.placeholder} x${s.count} in ${rel(s.file)}`),
      ...otherNote,
      note: pendingFiles.length
        ? "no changes written; re-run with --apply to render (every changed file is copied to backups/ first)"
        : "nothing to render: no identity placeholders on the model-facing surfaces",
    }, 0);
  }

  if (pendingFiles.length === 0) {
    out({ ok: true, dryRun: false, ...base, rendered: 0, filesChanged: 0, ...otherNote, note: "nothing to render: identity is already in place" }, 0);
  }

  // Backup first: only the files about to change, under the same relative paths.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const backupDir = join(configRoot, "backups", `render-identity-${stamp}`);
  for (const f of pendingFiles) {
    const dst = join(backupDir, rel(f));
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(f, dst);
  }

  let modified = 0;
  let applied = 0;
  for (const root of roots) {
    const r = substituteTree(root, vars);
    modified += r.modified;
    applied += r.applied;
  }

  // settings.json carries the name inside JSON strings: if it no longer parses, put the original back and fail loudly.
  const settings = join(configRoot, "settings.json");
  if (pendingFiles.includes(settings)) {
    try {
      JSON.parse(readFileSync(settings, "utf-8"));
    } catch (e) {
      writeFileSync(settings, readFileSync(join(backupDir, rel(settings))));
      out({ ok: false, ...base, error: `settings.json no longer parsed after rendering (${String(e).split("\n")[0]}); the original was put back`, backup: backupDir }, 1);
    }
  }

  const after = scan();
  const survivors = after.filter(mine);
  const left = survivors.reduce((n, s) => n + s.count, 0);
  const ok = left === 0;
  out({
    ok,
    dryRun: false,
    ...base,
    rendered: applied,
    filesChanged: modified,
    survivors: left,
    survivorSample: survivors.slice(0, 5).map((s) => `${s.placeholder} x${s.count} in ${rel(s.file)}`),
    backup: backupDir,
    ...otherNote,
    note: ok ? "identity rendered; run the Doctor to confirm" : "some identity placeholders survived — they sit outside the files substituteTree reads (see survivorSample)",
  }, ok ? 0 : 1);
}

main();

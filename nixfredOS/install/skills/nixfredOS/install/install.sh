#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#   nixfredOS — One-Line Bootstrap Installer
#   curl -fsSL https://ournixfredos.ai/install.sh | bash
#
#   Unlike a whole-harness install, this does NOT clobber your setup.
#   It drops the nixfredOS skill into your existing harness, then hands off
#   to the agentic `/nixfredOS setup`, which (with your permission) does the
#   conflict detection, the principal conversation, the TELOS interview
#   (current state + ideal state), pulls in any sources you provide, and
#   wires hooks — adapting to YOUR OS and harness as it goes.
#
#   What this script does (the bootstrap only):
#     1. Verifies prerequisites (curl, bash, tar; offers to install bun)
#     2. Detects your harness + any existing nixfredOS install (no clobber)
#     3. Fetches the latest nixfredOS release (or uses $NIXFREDOS_SRC locally)
#     4. Places the nixfredOS skill additively into your skills dir
#     5. Migrates stale pre-7.x launch aliases (`pai` → the 7.x launcher)
#     6. Hands off to `/nixfredOS setup` (the agentic onboarding)
#
#   Local/offline install (no network):
#     NIXFREDOS_SRC=/path/to/NIXFREDOS_RELEASES/<version> bash install.sh
#
#   Supply-chain handling — best-effort, and honest about where it stops
#   (public issue #1726, @rpriven; fallback tag: #1694):
#     • COMMIT-PINNED DOWNLOAD. Resolving a tag and then downloading
#       archive/refs/tags/<tag>.tar.gz are two separate requests, and a tag can
#       be force-moved in between (that is exactly how this repo publishes, see
#       CreateRelease). So we resolve the tag to its commit SHA and download
#       archive/<sha>.tar.gz — what was resolved is what is fetched. If SHA
#       resolution fails we fall back to the tag tarball and SAY SO out loud.
#     • CHECKSUM. GitHub publishes no checksum for these generated tarballs, so
#       nothing here can verify the download against an upstream signature —
#       full supply-chain verification is not achievable from this script alone.
#       What it does: download to a file, sha256 it BEFORE extracting, and print
#       the digest. Set NIXFREDOS_EXPECTED_SHA256=<hex> to hard-fail on a mismatch,
#       using a value obtained out of band (a prior install, another machine,
#       someone you trust). Caveat worth knowing: GitHub does not guarantee its
#       generated archives are byte-stable forever — a server-side compression
#       change alters the digest without the content changing. Compare digests
#       across machines at the same point in time, not against an old note.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Release resolution — always the latest published release ─────
# No pin: this resolves the newest GitHub Release at run time, so every new
# release reaches every installer with zero edits here. Override with
# NIXFREDOS_VERSION=x.y.z (or NIXFREDOS_TAG=vx.y.z) to force a specific version.
# Resolution order: (1) the releases/latest HTML redirect — NOT subject to the
# anonymous API rate limit (60/hr/IP) that made the old API-only path fail on
# shared IPs; (2) the GitHub API; (3) a stamped fallback tag, WITH a warning.
# NIXFREDOS_FALLBACK_TAG is stamped to the release version by EmitSkill at emit
# time — never edit it by hand, and never trust it silently (2026-07-12: a
# rate-limited API call silently installed v7.0.0 after v7.1.1 had shipped).
# The value in SOURCE still has to name a real release: EmitSkill only rewrites
# it on the emit path, and it had drifted to v7.3.2, a tag that was never
# published — so any source-run install that reached the fallback 404'd
# (public issue #1694). Corrected to the newest published release.
# Repo owner/name is parameterized — set at publish time, never hard-coded here.
NIXFREDOS_REPO="${NIXFREDOS_REPO:-nixfred/nixfredOS}"
NIXFREDOS_FALLBACK_TAG="v7.40.4"
if [ -n "${NIXFREDOS_VERSION:-}" ]; then
  NIXFREDOS_TAG="v${NIXFREDOS_VERSION}"
elif [ -z "${NIXFREDOS_TAG:-}" ]; then
  # 1) Redirect probe: github.com/<repo>/releases/latest 302s to .../releases/tag/vX.Y.Z
  NIXFREDOS_TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/${NIXFREDOS_REPO}/releases/latest" 2>/dev/null \
    | sed -n 's|.*/releases/tag/||p' || true)"
  # 2) API fallback (rate-limited for anonymous callers, so it's second)
  if [ -z "$NIXFREDOS_TAG" ]; then
    NIXFREDOS_TAG="$(curl -fsSL "https://api.github.com/repos/${NIXFREDOS_REPO}/releases/latest" 2>/dev/null \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
  fi
  # 3) Stamped fallback — loud, never silent
  if [ -z "$NIXFREDOS_TAG" ]; then
    NIXFREDOS_TAG="$NIXFREDOS_FALLBACK_TAG"
    echo "WARNING: could not resolve the latest release from GitHub (network/rate limit)." >&2
    echo "WARNING: installing pinned fallback ${NIXFREDOS_FALLBACK_TAG} — a newer release may exist." >&2
    echo "WARNING: re-run later, or force one with NIXFREDOS_VERSION=x.y.z" >&2
  fi
fi
# Harden the resolved tag before it is used ANYWHERE: it flows into a download
# URL below and, in migrate_rc, into rc-file content the user later sources. A
# hostile release name or env override (e.g. $'v1\nalias pwn=...\n#') must never
# reach either sink, so allow only GitHub's tag charset and reject empty. Runs
# before the first interpolation on purpose.
case "$NIXFREDOS_TAG" in
  ""|*[!A-Za-z0-9._-]*)
    printf 'FATAL: NIXFREDOS_TAG is empty or contains disallowed characters; refusing to continue: %s\n' \
      "$(printf '%s' "$NIXFREDOS_TAG" | tr -d '\n\r' | cut -c1-80)" >&2
    exit 1 ;;
esac
NIXFREDOS_VERSION="${NIXFREDOS_TAG#v}"
# Only an explicit override is honoured here — the default URL is built in Step
# 3, after the tag has been pinned to the commit SHA it resolved to.
NIXFREDOS_TARBALL_URL="${NIXFREDOS_TARBALL_URL:-}"
# Where the nixfredOS skill dir lives inside the release tree:
NIXFREDOS_RELEASE_SUBPATH="${NIXFREDOS_RELEASE_SUBPATH:-nixfredOS}"
# Local source override — point at a NIXFREDOS_RELEASES/<version> dir to install offline.
NIXFREDOS_SRC="${NIXFREDOS_SRC:-}"
# Target skills dir (auto-detected below; override to force).
NIXFREDOS_SKILLS_DIR="${NIXFREDOS_SKILLS_DIR:-}"
DRY_RUN="${DRY_RUN:-0}"

# ─── Colors / helpers ────────────────────────────────────────────
if [ -t 1 ]; then
  BLUE='\033[38;2;59;130;246m'; LIGHT_BLUE='\033[38;2;147;197;253m'
  DARK_BLUE='\033[38;2;29;78;216m'; GREEN='\033[38;2;34;197;94m'; YELLOW='\033[38;2;234;179;8m'
  RED='\033[38;2;239;68;68m'; DIM='\033[38;2;71;85;105m'; RESET='\033[0m'; BOLD='\033[1m'
else
  BLUE='' LIGHT_BLUE='' DARK_BLUE='' GREEN='' YELLOW='' RED='' DIM='' RESET='' BOLD=''
fi
info()    { printf "  ${BLUE}ℹ${RESET} %b\n" "$1"; }
success() { printf "  ${GREEN}✓${RESET} %b\n" "$1"; }
warn()    { printf "  ${YELLOW}⚠${RESET} %b\n" "$1"; }
error()   { printf "  ${RED}✗${RESET} %b\n" "$1" >&2; }
step()    { printf "\n${BOLD}${LIGHT_BLUE}▸ %s${RESET}\n" "$1"; }
run()     { if [ "$DRY_RUN" = "1" ]; then echo "  [DRY-RUN] $*"; else "$@"; fi; }
# sha256 of a file using whatever the platform ships — macOS has shasum, most
# Linux distros have sha256sum, and some have both. Prints the bare hex digest,
# or nothing at all when neither exists (callers must handle the empty string).
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  fi
}

printf "\n  ${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "  ${BOLD}${DARK_BLUE}nix${BLUE}fred${LIGHT_BLUE}OS${RESET}   ${BOLD}your AI operating system${RESET}      ${DIM}current state ${BLUE}→${DIM} ideal state${RESET}   ${DIM}·${RESET}   ${LIGHT_BLUE}v%s bootstrap${RESET}\n" "$NIXFREDOS_VERSION"
printf "  ${LIGHT_BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n\n"
[ "$DRY_RUN" = "1" ] && warn "DRY-RUN mode — no changes will be made."

# ─── Step 1: Prereqs ─────────────────────────────────────────────
step "1/6  Checking prerequisites"
OS="$(uname -s)"
case "$OS" in
  Darwin) info "Platform: macOS" ;;
  Linux)  info "Platform: Linux" ;;
  *)      warn "Unrecognized OS: $OS — proceeding; the setup will adapt." ;;
esac

need() { command -v "$1" >/dev/null 2>&1 && success "$1 ($(command -v "$1"))" || { error "Required: $1"; return 1; }; }
FAIL=0
need curl || FAIL=1
need bash || FAIL=1
need tar  || FAIL=1
[ $FAIL -ne 0 ] && { error "Install the missing prerequisites and re-run."; exit 1; }

# nixfredOS's bun.lock uses the v6 lockfile format, which bun < 1.2 cannot parse.
# So we require bun AND a modern-enough bun — auto-installing (which pulls the
# latest) via the same official installer whether bun is absent OR too old.
BUN_MIN_MAJOR=1
BUN_MIN_MINOR=2
bun_too_old() {
  # returns 0 (true) when the installed bun is older than $BUN_MIN_MAJOR.$BUN_MIN_MINOR
  local v major minor
  v="$(bun --version 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
  [ -z "$v" ] && return 0
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  case "$major" in ''|*[!0-9]*) return 0 ;; esac
  case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
  [ "$major" -gt "$BUN_MIN_MAJOR" ] && return 1
  [ "$major" -lt "$BUN_MIN_MAJOR" ] && return 0
  [ "$minor" -lt "$BUN_MIN_MINOR" ] && return 0 || return 1
}
install_bun() {
  # Dry-run must simulate end-to-end: the run wrapper suppresses the install,
  # so the postcondition check would abort the simulation (Forge audit, 2026-07-30).
  if [ "$DRY_RUN" = "1" ]; then info "[DRY-RUN] Would install bun (curl -fsSL https://bun.sh/install | bash)"; return 0; fi
  if [ "${NIXFREDOS_AUTO_INSTALL_BUN:-1}" = "1" ] && [ -z "${CI:-}" ] && [ -t 0 ]; then
    info "Installing bun..."
    run bash -c "curl -fsSL https://bun.sh/install | bash"
    [ -f "$HOME/.bun/bin/bun" ] && export PATH="$HOME/.bun/bin:$PATH" && hash -r && success "bun installed" \
      || { error "bun install failed"; exit 1; }
  else
    error "Install bun ≥ ${BUN_MIN_MAJOR}.${BUN_MIN_MINOR} first:  ${BOLD}curl -fsSL https://bun.sh/install | bash${RESET}"; exit 1
  fi
}

if ! command -v bun >/dev/null 2>&1; then
  warn "bun not found — nixfredOS tools need it."
  install_bun
elif bun_too_old; then
  warn "bun $(bun --version 2>/dev/null) is too old — nixfredOS needs bun ≥ ${BUN_MIN_MAJOR}.${BUN_MIN_MINOR} (v6 bun.lock format)."
  install_bun
fi
if [ "$DRY_RUN" != "1" ] && bun_too_old; then
  error "bun is still older than ${BUN_MIN_MAJOR}.${BUN_MIN_MINOR} ($(bun --version 2>/dev/null)). Upgrade with ${BOLD}bun upgrade${RESET} and re-run."; exit 1
fi
success "bun ($(command -v bun), v$(bun --version 2>/dev/null))"

# ─── Step 2: Detect harness (no clobber) ─────────────────────────
step "2/6  Detecting your harness"
if [ -z "$NIXFREDOS_SKILLS_DIR" ]; then
  if [ -d "$HOME/.claude" ]; then NIXFREDOS_SKILLS_DIR="$HOME/.claude/skills"
  elif [ -d "$HOME/.config/claude" ]; then NIXFREDOS_SKILLS_DIR="$HOME/.config/claude/skills"
  else NIXFREDOS_SKILLS_DIR="$HOME/.claude/skills"; fi
fi
info "Skills dir: ${BOLD}${NIXFREDOS_SKILLS_DIR/#$HOME/~}${RESET}"
TARGET="$NIXFREDOS_SKILLS_DIR/nixfredOS"
if [ -e "$TARGET" ]; then
  info "Existing nixfredOS skill found — it will be backed up AFTER the new release is fetched."
else
  success "No existing nixfredOS skill — clean drop-in."
fi

# ─── Step 3: Fetch the nixfredOS release ────────────────────────────
step "3/6  Fetching nixfredOS ${NIXFREDOS_TAG}"
TMP_DIR="$(mktemp -d -t nixfredos-install-XXXXXX)"
# The EXIT trap also restores the backed-up skill if we die MID-PLACEMENT —
# command failure alone was handled, but SIGINT/SIGTERM during the copy left
# no active skill despite the transactional promise (Forge audit, 2026-07-30).
PLACEMENT_BACKUP=""
PLACEMENT_DONE=0
restore_on_abort() {
  rm -rf "$TMP_DIR"
  if [ -n "$PLACEMENT_BACKUP" ] && [ "$PLACEMENT_DONE" = "0" ] && [ -d "$PLACEMENT_BACKUP" ]; then
    rm -rf "$TARGET" 2>/dev/null || true
    mv "$PLACEMENT_BACKUP" "$TARGET" 2>/dev/null || true
    echo "Aborted mid-placement — previous nixfredOS skill restored from backup." >&2
  fi
}
# Signals must EXIT (which fires the EXIT trap above) — a handler that merely
# restores would let bash resume the script afterward and reinstall over the
# restored backup (bash defers traps until the foreground child returns).
trap restore_on_abort EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "$NIXFREDOS_SRC" ]; then
  info "Local source: ${NIXFREDOS_SRC/#$HOME/~}"
  SRC_SKILL="$NIXFREDOS_SRC/$NIXFREDOS_RELEASE_SUBPATH"
  [ -d "$SRC_SKILL" ] || { error "nixfredOS skill not found at $SRC_SKILL"; exit 1; }
else
  info "Downloading ${NIXFREDOS_TAG} (HTTPS, no auth)..."
  if [ "$NIXFREDOS_REPO" = "OWNER/REPO" ]; then
    error "Network install needs NIXFREDOS_REPO set (owner/name), or use NIXFREDOS_SRC for a local install."; exit 1
  fi
  # Pin the download to the commit the tag pointed at AT RESOLUTION TIME. The
  # tag→tarball gap is a real window here: releases force-move tags, so the two
  # requests could disagree. Resolution is read-only, so it runs in dry-run too.
  NIXFREDOS_COMMIT=""
  if [ -z "$NIXFREDOS_TARBALL_URL" ]; then
    # 1) API — the vnd.github.sha media type answers with the bare 40-char SHA.
    NIXFREDOS_COMMIT="$(curl -fsSL -H 'Accept: application/vnd.github.sha' \
      "https://api.github.com/repos/${NIXFREDOS_REPO}/commits/${NIXFREDOS_TAG}" 2>/dev/null \
      | tr -d '[:space:]' || true)"
    # 2) git ls-remote — no anonymous API rate limit. An annotated tag resolves
    #    to the tag OBJECT on refs/tags/<tag>, so prefer the ^{} peeled line.
    if ! printf '%s' "$NIXFREDOS_COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
      if command -v git >/dev/null 2>&1; then
        LS_REMOTE="$(git ls-remote "https://github.com/${NIXFREDOS_REPO}.git" \
          "refs/tags/${NIXFREDOS_TAG}" "refs/tags/${NIXFREDOS_TAG}^{}" 2>/dev/null || true)"
        # `|| true` on both: a non-matching grep is a normal outcome here, and
        # under `set -o pipefail` its exit 1 would abort the whole install.
        NIXFREDOS_COMMIT="$(printf '%s\n' "$LS_REMOTE" | grep '\^{}$' | head -n 1 | cut -f1 || true)"
        [ -n "$NIXFREDOS_COMMIT" ] || NIXFREDOS_COMMIT="$(printf '%s\n' "$LS_REMOTE" | head -n 1 | cut -f1 || true)"
        NIXFREDOS_COMMIT="$(printf '%s' "$NIXFREDOS_COMMIT" | tr -d '[:space:]')"
      fi
    fi
    if printf '%s' "$NIXFREDOS_COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
      NIXFREDOS_TARBALL_URL="https://github.com/${NIXFREDOS_REPO}/archive/${NIXFREDOS_COMMIT}.tar.gz"
      info "Pinned ${NIXFREDOS_TAG} to commit ${NIXFREDOS_COMMIT}"
    else
      NIXFREDOS_COMMIT=""
      NIXFREDOS_TARBALL_URL="https://github.com/${NIXFREDOS_REPO}/archive/refs/tags/${NIXFREDOS_TAG}.tar.gz"
      warn "Could not resolve ${NIXFREDOS_TAG} to a commit SHA — downloading the TAG tarball instead."
      warn "That tag can move between now and the download; check the printed sha256 if that matters to you."
    fi
  else
    info "Using NIXFREDOS_TARBALL_URL override — no commit pinning."
  fi

  TARBALL="$TMP_DIR/nixfredos-${NIXFREDOS_TAG}.tar.gz"
  if [ "$DRY_RUN" = "1" ]; then
    # The download is suppressed, so the postconditions below would abort the
    # simulation against an empty TMP_DIR (Forge audit, 2026-07-30 — same class
    # as the install_bun postcondition). Simulate the resolved path.
    info "[DRY-RUN] Would download $NIXFREDOS_TARBALL_URL, sha256 it, then extract it"
    SRC_SKILL="$TMP_DIR/[dry-run-extracted]/$NIXFREDOS_RELEASE_SUBPATH"
    info "[DRY-RUN] Would extract the tarball and resolve the skill at .../$NIXFREDOS_RELEASE_SUBPATH"
  else
    # Download to a FILE, hash it, THEN extract — never `curl | tar`, which
    # extracts bytes nobody ever looked at and leaves nothing to compare.
    curl -fsSL -o "$TARBALL" "$NIXFREDOS_TARBALL_URL" \
      || { error "Download failed: $NIXFREDOS_TARBALL_URL"; exit 1; }
    TARBALL_SHA256="$(sha256_of "$TARBALL")"
    if [ -n "$TARBALL_SHA256" ]; then
      printf "\n  ${BOLD}sha256 of the downloaded tarball${RESET}\n  ${BOLD}${LIGHT_BLUE}%s${RESET}\n" "$TARBALL_SHA256"
      printf "  ${DIM}%s${RESET}\n\n" "$NIXFREDOS_TARBALL_URL"
    else
      warn "Neither shasum nor sha256sum is installed — cannot hash the download."
    fi
    if [ -n "${NIXFREDOS_EXPECTED_SHA256:-}" ]; then
      if [ -z "$TARBALL_SHA256" ]; then
        error "NIXFREDOS_EXPECTED_SHA256 is set but no sha256 tool is available — refusing to install unverified."; exit 1
      fi
      EXPECTED_SHA256="$(printf '%s' "$NIXFREDOS_EXPECTED_SHA256" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
      if [ "$EXPECTED_SHA256" != "$TARBALL_SHA256" ]; then
        error "sha256 MISMATCH — refusing to install."
        error "  expected: $EXPECTED_SHA256"
        error "  actual:   $TARBALL_SHA256"
        exit 1
      fi
      success "sha256 matches NIXFREDOS_EXPECTED_SHA256"
    fi
    tar -xzf "$TARBALL" -C "$TMP_DIR" \
      || { error "Extraction failed — the download may be truncated or corrupt."; exit 1; }
    rm -f "$TARBALL"
    EXTRACTED="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    SRC_SKILL="$EXTRACTED/$NIXFREDOS_RELEASE_SUBPATH"
    [ -d "$SRC_SKILL" ] || { error "nixfredOS skill not in tarball at $NIXFREDOS_RELEASE_SUBPATH"; exit 1; }
  fi
fi
if [ -n "${NIXFREDOS_COMMIT:-}" ]; then success "Fetched ${NIXFREDOS_TAG} (commit ${NIXFREDOS_COMMIT})"; else success "Fetched ${NIXFREDOS_TAG}"; fi

# Back up the existing skill ONLY now that a usable source is in hand. Doing this
# in Step 2 meant any Step 3 failure — an unset NIXFREDOS_REPO, a missing local
# source, a network error — left the user with no active nixfredOS skill and a
# backup directory they had to find themselves.
if [ -e "$TARGET" ]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  warn "Existing nixfredOS skill — backing up ONLY it to nixfredOS.backup-$TS (your other files are untouched)."
  run mv "$TARGET" "$TARGET.backup-$TS"
  [ "$DRY_RUN" = "1" ] || PLACEMENT_BACKUP="$TARGET.backup-$TS"
fi

# ─── Step 4: Place the skill (additive) ──────────────────────────
step "4/6  Installing the nixfredOS skill (additive — nothing else touched)"
run mkdir -p "$NIXFREDOS_SKILLS_DIR"
# Transactional placement: a failed copy (permissions, disk, interrupt) must
# restore the backup instead of leaving no active skill (Forge audit, 2026-07-30).
if [ "$DRY_RUN" = "1" ]; then
  run cp -R "$SRC_SKILL" "$TARGET"
else
  if ! cp -R "$SRC_SKILL" "$TARGET"; then
    if [ -n "${TS:-}" ] && [ -d "$TARGET.backup-$TS" ]; then
      rm -rf "$TARGET" 2>/dev/null || true
      mv "$TARGET.backup-$TS" "$TARGET"
      error "Skill copy failed — previous installation RESTORED from backup. Fix the underlying error (disk space? permissions?) and re-run."
    else
      error "Skill copy failed and no backup exists — re-run the installer after fixing the underlying error."
    fi
    exit 1
  fi
fi
PLACEMENT_DONE=1
success "nixfredOS skill placed at ${TARGET/#$HOME/~}"

# Interceptor verification captures must never ride into a user's backup commit
# (public issue #1566, @xmasyx): keeping the config root under git with a private
# remote is common, and captures can contain authenticated pages. Name-anchored,
# NOT extension-anchored — both .png and .jpg captures have been observed, and a
# format change must not silently reopen the hole. Idempotent append.
GITIGNORE_TARGET="$(dirname "$NIXFREDOS_SKILLS_DIR")/.gitignore"
# Each rule is guarded INDIVIDUALLY — a compound guard keyed on the first rule
# left older installs missing every rule added later (Forge audit, 2026-07-30).
# Direct redirection, never a path interpolated into a bash -c string — a
# single quote in HOME would terminate the quoting and reparse the path as
# shell syntax (Forge audit P1, 2026-07-30).
append_gitignore_line() {
  if [ "$DRY_RUN" = "1" ]; then echo "  [DRY-RUN] append to gitignore: $1"; else printf '%s\n' "$1" >> "$GITIGNORE_TARGET"; fi
}
CAPTURE_RULES_ADDED=0
for capture_rule in 'interceptor-screenshot-*' 'interceptor-capture-*' 'interceptor-macos-screenshot-*'; do
  if ! grep -qxF "$capture_rule" "$GITIGNORE_TARGET" 2>/dev/null; then
    if [ "$CAPTURE_RULES_ADDED" = "0" ] && ! grep -q '# Interceptor verification captures' "$GITIGNORE_TARGET" 2>/dev/null; then
      append_gitignore_line ''
      append_gitignore_line '# Interceptor verification captures — never commit (name-anchored; capture format varies)'
    fi
    append_gitignore_line "$capture_rule"
    CAPTURE_RULES_ADDED=1
  fi
done
[ "$CAPTURE_RULES_ADDED" = "1" ] && success "Backup-safety gitignore rules for Interceptor captures in place"

# ─── Step 5: Migrate stale pre-7.x launch aliases (upgrade path) ──
# Pre-7.x installs wired a `pai` launch alias — either `cd ~/.claude && claude`
# or `bun ~/.claude/PAI/ACTIONS/pai.ts`. 7.x renamed PAI/ → NIXFREDOS/ and made the
# launch constitutional (`nixfredos.ts -s NIXFREDOS_SYSTEM_PROMPT.md`), so an old alias
# either dies on the missing PAI/ path or silently launches WITHOUT the
# constitution. Repoint stale aliases in place — SAME alias name, so the user's
# muscle-memory invocation keeps working — and add the canonical `nixfredos` alias.
# Detection is deliberately tight (only the two documented historical forms:
# a /PAI/ path, or a bare `&& claude` launch); a current 7.x alias always
# contains NIXFREDOS_SYSTEM_PROMPT and is never touched, and the maintainer-side
# Arbol CLI alias (ARBOL/Actions/nixfredos.ts — not shipped in the public payload)
# matches neither pattern. The rc is backed up
# first; the rewrite is idempotent (commented lines no longer match). Skip
# entirely with NIXFREDOS_SKIP_ALIAS=1. Fish users: migrate the funcsaved alias
# by hand (see INSTALL.md step 7).
step "5/6  Migrating launch aliases (pre-7.x upgrades)"
CONFIG_ROOT="$(dirname "$NIXFREDOS_SKILLS_DIR")"
LAUNCHER="$CONFIG_ROOT/NIXFREDOS/TOOLS/nixfredos.ts"
SYS_PROMPT="$CONFIG_ROOT/NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md"
# Single-quote a value for safe embedding in shell source. A literal `'` is
# closed, backslash-escaped and reopened (it's → 'it'\''s'). Needed because the
# alias body is re-parsed by the shell: an unquoted $HOME with a space breaks the
# launcher, and one with a quote corrupts the rc file — and by this point the old
# working alias is already commented out, so the user is left with no alias.
# Ported from public PR #1739, @elhoim.
shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
migrate_rc() {
  local rc="$1" stale names n ts
  [ -f "$rc" ] || return 0
  stale="$(grep -E '^[[:space:]]*alias[[:space:]]+(pai|kai|lifeos|nixfredos)=' "$rc" 2>/dev/null \
    | grep -v 'NIXFREDOS_SYSTEM_PROMPT' \
    | grep -E '/PAI/|&&[[:space:]]*claude' || true)"
  [ -z "$stale" ] && return 0
  warn "Stale pre-7.x launch alias in ${rc/#$HOME/~}:"
  printf '%s\n' "$stale" | sed 's/^/      /'
  if [ "$DRY_RUN" = "1" ]; then echo "  [DRY-RUN] Would back up ${rc/#$HOME/~}, comment the line(s) out, and repoint to the 7.x launcher."; return 0; fi
  ts="$(date +%Y%m%d-%H%M%S)"
  cp "$rc" "$rc.nixfredos-backup-$ts"
  names="$(printf '%s\n' "$stale" | sed -E 's/^[[:space:]]*alias[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=.*/\1/' | sort -u)"
  awk -v tag="$NIXFREDOS_TAG" '
    /^[[:space:]]*alias[[:space:]]+(pai|kai|lifeos|nixfredos)=/ && !/NIXFREDOS_SYSTEM_PROMPT/ && (/\/PAI\// || /&&[[:space:]]*claude/) {
      print "# [migrated to nixfredOS " tag " — see .nixfredos-backup] " $0; next
    }
    { print }
  ' "$rc" > "$rc.nixfredos-tmp" && mv "$rc.nixfredos-tmp" "$rc"
  if [ -f "$LAUNCHER" ]; then
    local add_nixfredos=1 alias_body
    # Two levels of quoting for two levels of parsing: the inner shq protects the
    # paths when the alias body runs, the outer one when the rc file is sourced.
    alias_body="bun $(shq "$LAUNCHER") -s $(shq "$SYS_PROMPT")"
    printf '%s\n' $names | grep -qx nixfredos && add_nixfredos=0
    grep -E '^[[:space:]]*alias[[:space:]]+nixfredos=' "$rc" 2>/dev/null | grep -q 'NIXFREDOS_SYSTEM_PROMPT' && add_nixfredos=0
    {
      echo ""
      echo "# nixfredOS ${NIXFREDOS_TAG} launch aliases (repointed from pre-7.x by install.sh)"
      for n in $names; do
        echo "alias $n=$(shq "$alias_body")"
      done
      if [ "$add_nixfredos" = "1" ]; then echo "alias nixfredos=$(shq "$alias_body")"; fi
    } >> "$rc"
    success "Repointed $(echo $names | tr '\n' ' ')to the constituted 7.x launcher (backup: $(basename "$rc").nixfredos-backup-$ts)"
  else
    warn "Old alias commented out, but the NIXFREDOS launcher isn't placed yet — /nixfredOS setup will wire the new alias (backup: $(basename "$rc").nixfredos-backup-$ts)."
  fi
}
if [ "${NIXFREDOS_SKIP_ALIAS:-0}" = "1" ]; then
  info "Skipping alias migration (NIXFREDOS_SKIP_ALIAS=1)."
else
  FOUND_STALE=0
  for RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [ -f "$RC" ] && grep -E '^[[:space:]]*alias[[:space:]]+(pai|kai|lifeos|nixfredos)=' "$RC" 2>/dev/null | grep -v 'NIXFREDOS_SYSTEM_PROMPT' | grep -qE '/PAI/|&&[[:space:]]*claude'; then FOUND_STALE=1; fi
    migrate_rc "$RC"
  done
  [ "$FOUND_STALE" = "0" ] && success "No stale pre-7.x launch aliases found."
fi

# ─── Step 6: Hand off to the agentic setup ───────────────────────
step "6/6  Onboarding"
if [ "$DRY_RUN" = "1" ]; then info "[DRY-RUN] Would launch /nixfredOS setup"; exit 0; fi
echo
success "nixfredOS is installed. Now let's set it up for YOU."
info "The rest is a conversation — it detects conflicts, asks about your TELOS"
info "(current state + ideal state), pulls in any sources you provide, and wires"
info "hooks with your permission. Nothing changes without you saying yes."
echo
if command -v claude >/dev/null 2>&1 && [ -z "${CLAUDECODE:-}" ]; then
  info "Launching setup..."
  exec claude "/nixfredOS setup"
else
  printf "  ${BOLD}Open your harness and run:${RESET}  ${LIGHT_BLUE}/nixfredOS setup${RESET}\n\n"
fi

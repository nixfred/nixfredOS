# nixfredOS 7.40.4 — the Life Operating System

> **nixfredOS is the AI harness that moves you from current state to ideal state — an intent engineering platform. The DA is the principal's AI assistant. Pulse is the Life Dashboard.**
> Canonical thesis: `NIXFREDOS/DOCUMENTATION/nixfredOS/nixfredOSThesis.md`. Everyone running nixfredOS names their own DA. nixfredOS targets AS3 on the nixfredOS Maturity Model, with lineage from "The Real Internet of Things" (2016).

@NIXFREDOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md
# Identity @-imports below are activated by the agentic `/nixfredOS setup` (via `skills/nixfredOS/Tools/ActivateImports.ts`) once the principal scaffolds USER files.
# Claude Code does not follow transitive @-imports, so each must be listed here directly.
# @NIXFREDOS/USER/TELOS/PRINCIPAL_TELOS.md
# @NIXFREDOS/USER/PRINCIPAL/PRINCIPAL_IDENTITY.md
# @NIXFREDOS/USER/DIGITAL_ASSISTANT/DA_IDENTITY.md
# @NIXFREDOS/USER/PROJECTS.md
# @NIXFREDOS/USER/CONFIG/OPERATIONAL_RULES.md

## Constitutional layer

Constitutional rules, the unified response format, verification doctrine, hard prohibitions, security protocol, and operational rules all live in the system prompt: `NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md`. When this file and the system prompt disagree, the system prompt wins.

This file is the **routing table** — it tells you where everything lives. The only mandatory startup `@`-import shipped with public nixfredOS is `ARCHITECTURE_SUMMARY`. The five identity files (`PRINCIPAL_TELOS`, `PRINCIPAL_IDENTITY`, `DA_IDENTITY`, `PROJECTS`, `OPERATIONAL_RULES`) are commented out above — the agentic `/nixfredOS setup` (via `skills/nixfredOS/Tools/ActivateImports.ts`) uncomments them once the principal's USER scaffold is populated. Claude Code does not follow transitive `@`-imports from inside imported files, so each identity file must be listed here at top level. Everything below is **on-demand** lookup. Paths are relative to `~/.claude/` unless noted.

## nixfredOS System (paths under `NIXFREDOS/DOCUMENTATION/` unless noted)

- **nixfredOS thesis** — `nixfredOS/nixfredOSThesis.md` (canonical source of truth)
- **nixfredOS schema** — `nixfredOS/nixfredOSSchema.md` (biography-flat, PascalCase, frontmatter contract)
- **System prompt** — `NIXFREDOS/NIXFREDOS_SYSTEM_PROMPT.md` (loaded via `--append-system-prompt-file`; home of the constitutional rules and response format)
- **System architecture** — `nixfredOSSystemArchitecture.md` (master doc)
- **Architecture summary** — `ARCHITECTURE_SUMMARY.md` (loaded via @-import)
- **Core components** (canonical two-tier component map) — `CoreComponents.md`
- Algorithm (the unified thinking system) — `Algorithm/AlgorithmSystem.md`
- Cortex (the memory system) — `Memory/MemorySystem.md`
- Skills — `Skills/SkillSystem.md`
- Hooks — `Hooks/HookSystem.md`
- Agents — `Agents/AgentSystem.md`
- Delegation — `Delegation/DelegationSystem.md` (RETIRED — history only; agent orchestration is native harness surface: tool schemas + Algorithm §Spend election rules)
- Router — `Router/RouterSystem.md` (RETIRED — history only; mode/tier classification was abolished and model rungs now live in `NIXFREDOS/TOOLS/models.ts`)
- Security — `Security/README.md`
- Notifications — `Notifications/NotificationSystem.md`
- Observability — `Observability/ObservabilitySystem.md`
- Pulse — `Pulse/PulseSystem.md`
- Pulse metadata catalog (badges/strips/panels) — `Pulse/PulseMetadata.md`
- Pulse tooltips — `Pulse/Tooltips.md`
- DA subsystem (design) — `Pulse/DaSubsystem.md`
- Ledger (change tracking: versioning, update registry, integrity gate, deploy events) — `Ledger/LedgerSystem.md`
- Upgrades (the system-improvement queue) — `Upgrades/UpgradesSystem.md`
- Atlas (current state of everything you own; `atlas` CLI, Pulse `/atlas`) — `Atlas/AtlasSystem.md`
- Bunker (universal application harness — six planes, ISA-as-test-suite; concept doc, reference implementation not shipped) — `Bunker/BunkerSystem.md`
- Synapse (input router — capture → amber ledger → grade vs TELOS → route) — `Synapse/SynapseSystem.md`
- Conduit (sensory layer — local current-state capture, feeds memory + TELOS) — `Conduit/ConduitSystem.md`
- Work system (capture surfaces → private GitHub Issues as system of record) — `Work/WorkSystem.md`
- Background services (every recurring job + the one-shot installer) — `Services/BackgroundServices.md`
- Hermes sidecar (optional second front door — talk to your nixfredOS as an agent) — `Hermes/HermesSidecar.md`
- Custom spinner verbs + tips — `Spinner/SpinnerSystem.md`
- Brand assets — `BrandAssets.md`
- CLI tools (Algorithm + Arbol) — `Tools/Cli.md`
- CLI-first architecture — `Tools/CliFirstArchitecture.md`
- Configuration — `Config/ConfigSystem.md`
- Containment policy — `Tools/Containment.md`
- Arbol (cloud execution) — `Arbol/ArbolSystem.md`
- Feed — `Feed/FeedSystem.md`
- Fabric — `Fabric/FabricSystem.md`
- Freshness convention (`pai-freshness-v1`) — `Freshness/FreshnessSystem.md`
- Terminal tabs — `Pulse/TerminalTabs.md`
- Tools reference — `Tools/Tools.md`
- ISA — `ISA/ISASystem.md`
- ISA format spec — `ISA/ISAFormat.md`
- Testing doctrine — `Testing/TestingDoctrine.md`
- System/user boundary — `SystemUserBoundary.md` (which files are SYSTEM, which are USER, how the boundary is enforced)
- AI writing patterns (system-level reference) — `Writing/AIWritingPatterns.md`
- Browser automation — `Skill("Interceptor")` (real Chrome, mandatory for verification)
- Claude Code knowledge — `Agent(subagent_type="claude-code-guide")`

## Principal — Identity & Voice (paths under `NIXFREDOS/USER/`)

Populated during `/nixfredOS setup`. Typical layout:

- Principal identity — `PRINCIPAL/PRINCIPAL_IDENTITY.md` (canonical, @-imported)
- Career & resume — `PRINCIPAL/RESUME.md`
- Writing style — `PRINCIPAL/WRITINGSTYLE.md`
- Pronunciations — `PRINCIPAL/PRONUNCIATIONS.json` (TTS rules — Pulse VoiceServer reads this)
- Contacts — `CONTACTS.md`
- Definitions — `DEFINITIONS.md`
- Core content themes — `CANONICAL_CONTENT.md`

## Principal — Life Goals

- TELOS (single source of truth, unified H2 sections) — `NIXFREDOS/USER/TELOS/TELOS.md`
- Auto-generated derivative — `NIXFREDOS/USER/TELOS/PRINCIPAL_TELOS.md`
- Dimension percentages — `NIXFREDOS/USER/TELOS/NIXFREDOS_STATE.json` (Pulse rings + statusline read from this)
- Freshness convention — see `NIXFREDOS/DOCUMENTATION/Freshness/FreshnessSystem.md`

## Principal — Work (paths under `NIXFREDOS/USER/`)

> These are the conventional locations for your own content. A fresh install ships the scaffold, not the folders — create each one when you first put something in it.

- Business — `BUSINESS/`
- Health — `HEALTH/`
- Finances — `FINANCES/`
- Integration configs — `INTEGRATIONS/*.yaml`
- Work system — `WORK/config.yaml`
- Secrets — `~/.claude/.env` (canonical; see OPERATIONAL_RULES.md)

## Project-Specific Rules

Drop project-scoped CLAUDE.md files alongside each project (e.g. `~/code/your-project/CLAUDE.md`) for rules that only apply inside that codebase. Claude Code merges them with this global file when sessions start in that directory. Use them for invariants that bite repeatedly — "always use the X helper, never bare Y" — so the rule lives next to the code it governs.

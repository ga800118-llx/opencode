# Phase 1-3 Change Map

## Phase 1: Product Adapter

- Add product adapter contracts beside existing App platform and SDK contexts.
- Put privileged credential and platform methods behind typed Desktop main/preload IPC.
- Extend sidecar status reporting without replacing its lifecycle.
- Add compatibility tests around consumed SDK, event, persistence, and provider contracts.
- Establish product identity in one configuration boundary rather than scattering constants.

## Phase 2: Visual Model Center

- Extend provider settings and the custom-provider form into guided provider profiles.
- Keep OpenCode's provider catalog and model contexts authoritative.
- Add cloud, private OpenAI-compatible, Ollama, LM Studio, and custom-local profiles.
- Store credential references through Desktop IPC; never persist raw keys in renderer state.
- Add connection and capability diagnostics without changing core invocation semantics.
- Preserve raw headers, environment references, model IDs, and other advanced fields.

## Phase 3: Codex-Style Desktop Workflow

- Evolve existing project/session navigation, prompt input, timeline, diff, and terminal components.
- Add Simple and Advanced presentation modes over the same configuration and runtime.
- Treat sessions as tasks while preserving multiple tabs and all parity rows.
- Keep product text in existing English and Simplified Chinese catalogs.
- Add first-run model setup, clear empty/error states, and recoverable sidecar diagnostics.

## Core Patch Rule

No Phase 1-3 task edits `packages/core`, `packages/opencode`, `packages/server`,
`packages/protocol`, or generated clients unless a tested adapter approach is
proven insufficient. Any exception requires a compatibility test and a written
rationale in the implementation plan.

## Product-Owned Write Set

Prefer changes in these areas:

- New product adapter modules under `packages/app/src` and `packages/desktop/src`
- `packages/app/src/components/settings-v2`
- `packages/app/src/pages/home` and `packages/app/src/pages/new-session`
- Product identity, icons, renderer copy, and packaging files under `packages/desktop`
- Existing App/Desktop i18n catalogs

Shared contexts and renderer entry points are allowed only as narrow wiring changes.

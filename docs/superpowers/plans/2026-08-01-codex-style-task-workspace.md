# Codex-Style Task Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `subagent-driven-development` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a task-first Agent Desktop experience with Simple and Advanced
presentation modes, visual model readiness, recoverable sidecar diagnostics,
and Codex-style workflow clarity without removing any OpenCode capability.

**Architecture:** Preserve OpenCode sessions, providers, tabs, timeline, review,
terminal, permissions, and runtime as the only sources of truth. Add pure
product workflow helpers under `packages/app/src/product/workflow`, expose a
persisted presentation preference through the existing Settings context, and
compose setup/recovery notices into existing Home, New Session, Layout, and
Session views. Reuse the Phase 1 Product Host and Phase 2 Model Center; no new
runtime protocol is introduced.

**Tech Stack:** Bun 1.3.14, TypeScript, SolidJS, Electron 42, existing OpenCode UI
primitives, Bun test with happy-dom, Agent Browser, axe-core.

---

## Write Boundaries

Preferred Phase 3 writes:

- `packages/app/src/product/workflow/**`
- `packages/app/src/context/settings.tsx` and focused settings tests
- `packages/app/src/components/settings-v2/**`
- `packages/app/src/pages/home/**`
- `packages/app/src/pages/new-session/**`
- narrow `packages/app/src/pages/layout/**` and `packages/app/src/pages/session/**`
- `packages/app/src/i18n/en.ts` and `packages/app/src/i18n/zh.ts`
- product identity copy under `packages/desktop/src/product/**`
- `docs/product/phase-3/**`

Forbidden without a written exception and focused compatibility test:

- `packages/core/**`
- `packages/opencode/**`
- `packages/server/**`
- `packages/protocol/**`
- generated SDK clients

## Invariants

1. A task is an existing OpenCode session. No task database, ID, route, or API
   is added.
2. Presentation mode never changes model/provider config, task data, terminal
   state, permission policy, open tabs, or execution behavior.
3. Every capability hidden from initial Simple presentation stays reachable by
   switching to Advanced in one action.
4. Sidecar UI consumes only sanitized Product Host status and never displays raw
   process output, paths, environment values, or credentials.
5. Model setup composes the existing Models settings and Phase 2 Model Center;
   it does not duplicate provider persistence.
6. App workflow modules contain no Electron imports or macOS-only assumptions.

## Phase Gate

Phase 3 is complete only when:

1. Simple defaults correctly and Advanced switches without reload or data loss;
2. task wording and primary actions are consistent in English and Simplified
   Chinese;
3. model setup and sidecar recovery paths work in the packaged app;
4. all feature-parity rows remain reachable;
5. App/Desktop unit tests, type checks, lint, build, package, accessibility,
   responsive visual review, secret scan, startup checks, and protected-runtime
   diff pass.

### Task 1: Define Presentation And Workflow State Contracts

**Files:**

- Create: `packages/app/src/product/workflow/presentation.ts`
- Create: `packages/app/src/product/workflow/presentation.test.ts`
- Create: `packages/app/src/product/workflow/model-readiness.ts`
- Create: `packages/app/src/product/workflow/model-readiness.test.ts`
- Create: `packages/app/src/product/workflow/index.ts`
- Modify: `packages/app/src/index.ts`

- [x] **Step 1: Write failing presentation tests**

Assert `normalizePresentationMode` accepts only `simple` and `advanced`, maps
missing/corrupt persisted values to `simple`, and returns stable presentation
flags without mutating input.

- [x] **Step 2: Write failing model-readiness tests**

Cover loading providers, usable selected model, visible connected models,
empty/unconnected providers, and unavailable desktop Model Center. The result
must be one of `loading`, `ready`, `setup-required`, or `desktop-unavailable`.

- [x] **Step 3: Confirm the tests fail because modules are absent**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/product/workflow
```

- [x] **Step 4: Implement pure contracts and focused exports**

Keep helpers framework-light. Presentation normalization takes `unknown`.
Model readiness takes plain booleans/counts so it can be tested without
mounting providers and reused by Home/New Task.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/product
bun run typecheck
git add src/product src/index.ts
git commit -m "feat: define task workspace presentation state"
```

Expected: product tests and App type check pass.

### Task 2: Persist And Expose Simple/Advanced Mode

**Files:**

- Modify: `packages/app/src/context/settings.tsx`
- Modify: `packages/app/src/context/settings.test.ts`
- Create: `packages/app/src/components/settings-v2/presentation-mode.tsx`
- Create: `packages/app/src/components/settings-v2/presentation-mode.test.tsx`
- Modify: `packages/app/src/components/settings-v2/general.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [x] **Step 1: Add failing settings tests**

Assert the default is `simple`, a persisted `advanced` value is restored,
corrupt values resolve to `simple`, switching writes only
`general.presentationMode`, and switching does not call reload.

- [x] **Step 2: Add failing control rendering tests**

Render the control with the existing select/segmented primitive. Assert labels,
keyboard-reachable options, selected state, and callback values in both modes.

- [x] **Step 3: Implement the settings API**

Add `presentationMode?: ProductPresentationMode` to persisted settings and
expose:

```ts
settings.general.presentationMode()
settings.general.setPresentationMode("simple" | "advanced")
settings.presentation.simple()
settings.presentation.advanced()
```

Use the product normalizer and preserve existing `settings.v3` migration
behavior.

- [x] **Step 4: Put the mode row first in General settings**

Render localized title, description, and exact Simple/Advanced options. Keep
the complete existing General settings reachable; in Simple mode, group the
existing technical rows under a clearly labeled Advanced section rather than
deleting or resetting them.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/context/settings.test.ts \
  ./src/components/settings-v2/presentation-mode.test.tsx
bun run typecheck
git add src/context/settings.tsx src/context/settings.test.ts \
  src/components/settings-v2 src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: add simple and advanced interface modes"
```

Expected: mode changes immediately and no setting outside the mode key changes.

### Task 3: Add Model Readiness And First-Task Setup

**Files:**

- Create: `packages/app/src/product/workflow/use-model-readiness.ts`
- Create: `packages/app/src/product/workflow/use-model-readiness.test.tsx`
- Create: `packages/app/src/components/workflow/model-setup-notice.tsx`
- Create: `packages/app/src/components/workflow/model-setup-notice.test.tsx`
- Modify: `packages/app/src/pages/new-session/new-session-view.tsx`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `packages/app/src/pages/home.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [x] **Step 1: Write failing readiness hook tests**

Stub Models, Providers, Local, and Product Host state. Assert no probe runs on
render, built-in/connected models count as ready, loading is stable, and an
empty model set produces setup-required.

- [x] **Step 2: Write failing notice tests**

Assert the notice is absent for ready/loading, appears for setup-required,
contains one primary Configure models action, opens V2 Settings on the Models
tab, and wraps at narrow width without fixed text dimensions.

- [x] **Step 3: Implement a reusable notice**

Use existing ButtonV2/IconV2 components, semantic status markup, and no modal
wizard. Extend the settings dialog's typed default tab only as needed so callers
can open `models` directly.

- [x] **Step 4: Compose the notice into Home and New Task**

Keep the composer first and avoid layout shift while readiness is loading. The
notice disappears reactively after a model becomes usable. Preserve the
existing provider tip only when it adds information not covered by setup state.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/product/workflow ./src/components/workflow
bun run typecheck
git add src/product/workflow src/components/workflow src/pages/home.tsx \
  src/pages/new-session.tsx src/pages/new-session/new-session-view.tsx \
  src/components/settings-v2/dialog-settings-v2.tsx src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: guide first task model setup"
```

Expected: existing usable models never trigger redundant onboarding.

### Task 4: Add Recoverable Sidecar Status

**Files:**

- Create: `packages/app/src/product/workflow/sidecar-status.ts`
- Create: `packages/app/src/product/workflow/sidecar-status.test.ts`
- Create: `packages/app/src/product/workflow/use-sidecar-recovery.ts`
- Create: `packages/app/src/product/workflow/use-sidecar-recovery.test.tsx`
- Create: `packages/app/src/components/workflow/sidecar-recovery-notice.tsx`
- Create: `packages/app/src/components/workflow/sidecar-recovery-notice.test.tsx`
- Modify: `packages/app/src/pages/layout.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [ ] **Step 1: Write failing state-mapping tests**

Assert ready/unmanaged/unavailable are hidden, short starting/restarting states
receive a grace period, failed and unexpected stopped states persist, and
sanitized error kind is the only error detail exposed.

- [ ] **Step 2: Write failing recovery-controller tests**

Use a fake Product Host and Platform. Assert one subscription, cleanup,
serialized restart calls, pending state, retry after failure, optional diagnostic
export, and no calls on browser hosts.

- [ ] **Step 3: Implement the controller and banner**

The banner uses `product.sidecar.getStatus/subscribe/restart` and
`platform.exportDebugLogs`. It contains Restart agent service and Export
diagnostics actions, `aria-live="polite"` for progress, and `role="alert"` only
for persistent failure.

- [ ] **Step 4: Mount once in the global layout**

Place the banner below desktop chrome and above route content so it never covers
tabs or the composer. Do not mount a controller per session.

- [ ] **Step 5: Verify App and Desktop Product Host contracts**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/product/workflow ./src/components/workflow
bun run typecheck
cd ../desktop
bun test src/product src/renderer/initialization.test.ts
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/product/workflow packages/app/src/components/workflow \
  packages/app/src/pages/layout.tsx packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat: add recoverable agent service status"
```

Expected: renderer recovery uses existing sanitized IPC and adds no channel.

### Task 5: Present Sessions As Tasks In Navigation And Home

**Files:**

- Modify: `packages/app/src/pages/layout.tsx`
- Modify: `packages/app/src/pages/layout/sidebar-shell.tsx`
- Modify: `packages/app/src/pages/layout/sidebar-project.tsx`
- Modify: `packages/app/src/pages/home/home-sessions-view.tsx`
- Modify: `packages/app/src/pages/home/home-sessions-controller.tsx`
- Modify: `packages/app/src/pages/home/home-session-search-controller.ts`
- Create: `packages/app/src/pages/home/task-copy.test.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [ ] **Step 1: Add failing workflow-copy tests**

Assert primary product keys render Tasks, New task, Recent tasks, Search tasks,
No tasks yet, archive-task labels, and equivalent Simplified Chinese copy. Keep
API/developer keys named session where renaming would change contracts.

- [ ] **Step 2: Update primary navigation actions**

Change visible sidebar/home labels and accessible names to task terminology.
Keep routes, command IDs, session IDs, list grouping, status indicators, archive,
search, drag, tabs, worktrees, and child-session behavior unchanged.

- [ ] **Step 3: Refine task empty states**

No-project state leads to Open project. Project-with-no-task leads to New task.
Search-empty names the active query and does not offer a destructive reset.

- [ ] **Step 4: Verify navigation behavior and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/pages/home ./src/pages/home-session-open.test.ts \
  ./src/pages/home-session-archive.test.ts ./src/context/layout-tabs.test.ts
bun run typecheck
git add src/pages/layout.tsx src/pages/layout src/pages/home src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: make desktop navigation task-first"
```

Expected: multiple tabs, child sessions, project switching, and archive/resume
paths retain their existing behavior.

### Task 6: Make New Task Prompt-First In Both Modes

**Files:**

- Create: `packages/app/src/pages/new-session/new-session-presentation.ts`
- Create: `packages/app/src/pages/new-session/new-session-presentation.test.ts`
- Modify: `packages/app/src/pages/new-session/new-session-view.tsx`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [ ] **Step 1: Write failing presentation-policy tests**

Assert Simple keeps composer, project selection, model selection, attachments,
and submit visible while making worktree/git and provider-promotion details
secondary. Assert Advanced exposes the complete existing control set.

- [ ] **Step 2: Implement presentation without duplicating the composer**

Pass presentation state into `NewSessionView`; reuse one
`PromptInputV2Composer`. Add a compact New task heading/supporting state only if
it improves hierarchy without moving the composer below the first viewport.
Use existing responsive constraints and keep the next section visible.

- [ ] **Step 3: Preserve draft and selection during mode switching**

Mode changes must not remount the draft controller, reset prompt text, restore a
different worktree, or change the selected model. Add a mounted component test
covering a non-empty draft.

- [ ] **Step 4: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/pages/new-session
bun run typecheck
git add src/pages/new-session.tsx src/pages/new-session src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: refine prompt-first new task flow"
```

Expected: submission still promotes the draft through the existing task adapter.

### Task 7: Refine The Task Workspace Without Removing Technical Surfaces

**Files:**

- Create: `packages/app/src/pages/session/task-presentation.ts`
- Create: `packages/app/src/pages/session/task-presentation.test.ts`
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/session-side-panel.tsx`
- Modify: `packages/app/src/pages/session/session-panel-layout.test.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/desktop/src/product/identity.ts`
- Modify: focused Desktop identity tests

- [ ] **Step 1: Write failing task-presentation tests**

Assert Simple uses existing collapsed tool-detail defaults and compact context
actions, while Advanced honors all existing review/file/terminal/agent/status
visibility settings. Assert both modes retain review, terminal, files,
permissions, questions, attachments, child sessions, commands, and model access.

- [ ] **Step 2: Integrate presentation state into existing layout helpers**

Do not fork `Page`, timeline, composer, review, or terminal trees. Derive only
initial visibility and labels through a pure task-presentation policy. Existing
user toggles and keyboard commands remain authoritative.

- [ ] **Step 3: Apply Agent Desktop identity copy**

Use the existing centralized Desktop product identity. Update product-facing
English/Simplified Chinese desktop labels without changing OpenCode API names,
configuration namespaces, protocol compatibility, or third-party attribution.

- [ ] **Step 4: Verify full App/Desktop tests and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts
bun run typecheck
cd ../desktop
bun test
bun run typecheck
git add packages/app/src/pages/session.tsx packages/app/src/pages/session \
  packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts \
  packages/desktop/src/product
git commit -m "feat: polish codex-style task workspace"
```

Expected: full App and Desktop suites pass with no protected-runtime diff.

### Task 8: Complete Packaged Acceptance And Phase Documentation

**Files:**

- Create: `docs/product/phase-3/verification.md`
- Create: `docs/product/phase-3/artifacts/task-workspace-simple.png`
- Create: `docs/product/phase-3/artifacts/task-workspace-advanced.png`
- Modify: `docs/product/baseline/feature-parity.md`
- Modify: this plan as tasks complete

- [ ] **Step 1: Run static and unit gates**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
cd packages/app && bun test --conditions=solid --preload ./happydom.ts && bun run typecheck
cd ../desktop && bun test && bun run typecheck
cd ../.. && bun run lint
```

Record exact test totals, assertion totals, lint errors/warnings, and any
pre-existing warnings separately.

- [ ] **Step 2: Build and package the exact candidate**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun run build
bun run package
```

Record app.asar, ZIP, and DMG SHA-256 hashes. Use a fresh acceptance data root,
never a developer profile reused from earlier smoke tests.

- [ ] **Step 3: Run Agent Browser workflow acceptance**

On the exact packaged candidate verify:

1. clean launch defaults to Simple;
2. configure/select a private or local model visually;
3. create a task and observe streaming completion;
4. open review/files/terminal and permission paths;
5. switch to Advanced with the task, tabs, draft, and terminal preserved;
6. search, archive, resume, and open multiple tasks;
7. simulate sanitized sidecar failure, restart, and export diagnostics;
8. restart the app and confirm selected mode/model/task continuity.

- [ ] **Step 4: Run visual and accessibility acceptance**

Capture 1440x900, 1024x768, and 720x800 in English and Simplified Chinese.
Inspect for overflow, overlap, clipped controls, blank panels, focus loss, and
layout shift. Run axe-core on Home, New Task, active Task, General settings in
both modes, Models settings, and sidecar failure banner. Require zero violations
or document and fix the responsible code before continuing.

- [ ] **Step 5: Run security and isolation checks**

```bash
git diff --exit-code v1.18.10...HEAD -- \
  packages/core packages/opencode packages/server packages/protocol
```

Scan the complete packaged data root, caches, logs, network data, sidecar config,
and package output for fixture credentials. Require zero plaintext matches.
Confirm only the current app data root and product identity were used.

- [ ] **Step 6: Update parity and verification evidence**

For every baseline row, name the exact visual route in Simple and Advanced and
the test or packaged acceptance evidence. Mark Windows credential backend and
Windows packaging as deferred; do not imply support not exercised in Phase 3.

- [ ] **Step 7: Commit documentation**

```bash
git add docs/product/phase-3 docs/product/baseline/feature-parity.md \
  docs/superpowers/plans/2026-08-01-codex-style-task-workspace.md
git commit -m "docs: complete phase 3 task workspace"
```

Expected: Phase 3 gate is fully evidenced, no task checkbox remains open, and
the worktree contains only user-owned unrelated files.

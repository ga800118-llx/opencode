# Thin-Fork Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a product-owned adapter and desktop-host boundary over the pinned OpenCode runtime, make the local server lifecycle observable and recoverable, isolate development identity and credential namespaces, and lock the boundary with tests and CI.

**Architecture:** Keep OpenCode Core, Server, Protocol, SDK generation, and provider internals unchanged. Product UI calls a small adapter built over `CompatibleApi`; Electron owns privileged lifecycle and future credential operations through typed IPC. A supervisor restarts the existing sidecar on unexpected exit while preserving one renderer-visible server connection. Product identity is centralized so final branding remains a configuration change rather than a cross-package rewrite.

**Tech Stack:** Bun 1.3.14, TypeScript, SolidJS, Electron 42, Effect, Electron utility process, Bun test, GitHub Actions.

---

## Write Boundaries

Preferred Phase 1 writes:

- `packages/app/src/product/**`
- narrow wiring in `packages/app/src/components/prompt-input/submit.ts` and `packages/app/src/index.ts`
- `packages/desktop/src/product/**`
- `packages/desktop/src/main/**`, `packages/desktop/src/preload/**`, and narrow renderer wiring
- `packages/desktop/electron-builder.config.ts`
- focused CI and product documentation

Forbidden without a written exception and compatibility test:

- `packages/core/**`
- `packages/opencode/**`
- `packages/server/**`
- `packages/protocol/**`
- generated SDK clients

## Phase Gate

Phase 1 is complete only when:

1. the inherited lint error and Arabic parity failure are repaired;
2. create, prompt, command, shell, and interrupt operations used by the composer pass through the product task adapter;
3. consumed OpenCode API and event shapes are protected by contract tests;
4. the local sidecar reports sanitized state and restarts after an unexpected exit;
5. renderer code cannot read sidecar credentials from lifecycle status APIs;
6. development application data and future credentials use isolated product namespaces;
7. focused CI, type checks, unit tests, build, package, and desktop smoke checks pass;
8. `git diff v1.18.10...HEAD -- packages/core packages/opencode packages/server packages/protocol` is empty.

### Task 1: Repair the inherited baseline failures

**Files:**

- Modify: `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- Modify: `packages/session-ui/src/v2/components/prompt-input/attachments.css`
- Create: `packages/session-ui/src/v2/components/prompt-input/placeholder.test.ts`
- Modify: `packages/app/src/i18n/{ar,br,bs,da,de,es,fr,ja,ko,no,pl,ru,th,tr,uk,zh,zht}.ts`
- Test: `packages/app/src/i18n/parity.test.ts`

- [x] **Step 1: Add a focused regression assertion for the CSS content escape**

Use the CSS hexadecimal escape form that survives TypeScript string parsing and is accepted by oxlint. Keep the zero-width placeholder behavior unchanged.

- [x] **Step 2: Add the five missing catalog keys**

Add translations for:

- `dialog.provider.custom.label`
- `dialog.model.unpaid.viewMoreProviders`
- `session.header.reveal.finder`
- `session.header.reveal.fileExplorer`
- `session.header.reveal.containingFolder`

The parity test stops at the first failing locale, so the Phase 0 report exposed
Arabic only. After that repair, all other 16 non-English App catalogs reported
the same five-key delta. Complete all 17 catalogs rather than weakening parity.

- [x] **Step 3: Run the inherited failure guards**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run lint
bun run --cwd packages/app test:unit
```

Expected: both commands exit 0; the prior lint error and five-key parity delta are gone.

- [x] **Step 4: Commit the baseline repair**

```bash
git add packages/session-ui/src/v2/components/prompt-input packages/app/src/i18n
git commit -m "fix: clear inherited quality baseline failures"
```

### Task 2: Centralize the isolated product identity

**Files:**

- Create: `packages/desktop/src/product/identity.ts`
- Create: `packages/desktop/src/product/identity.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/main/migrate.ts`
- Modify: `packages/desktop/electron-builder.config.ts`
- Modify where required: deep-link and generated metadata inputs under `packages/desktop`

- [ ] **Step 1: Write identity tests first**

Cover development app name, app ID, protocol scheme, data namespace, and credential namespace. Assert that development identifiers do not equal any OpenCode release identifier.

- [ ] **Step 2: Define one product identity boundary**

Expose typed channel identity values from one pure module. Use a neutral working development identity; do not choose final product branding in Phase 1. Keep beta/prod publishing disabled or upstream-owned until Phase 4 explicitly replaces release metadata.

- [ ] **Step 3: Wire main process, packaging, migration, and protocol registration**

Remove duplicated development constants. Development `userData`, protocol handling, and the future credential service namespace must derive from the centralized identity.

- [ ] **Step 4: Verify isolation**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
(cd packages/desktop && bun test src/product src/main)
bun run --cwd packages/desktop typecheck
```

Expected: tests and type check pass, and the development app cannot target `ai.opencode.desktop*` data directories.

- [ ] **Step 5: Commit identity isolation**

```bash
git add packages/desktop/src/product packages/desktop/src/main/index.ts packages/desktop/src/main/migrate.ts packages/desktop/electron-builder.config.ts packages/desktop/resources
git commit -m "feat: isolate desktop product identity"
```

### Task 3: Add product adapter contracts and error normalization

**Files:**

- Create: `packages/app/src/product/contracts.ts`
- Create: `packages/app/src/product/errors.ts`
- Create: `packages/app/src/product/errors.test.ts`
- Create: `packages/app/src/product/features.ts`
- Modify: `packages/app/src/index.ts`

- [ ] **Step 1: Define product-level contracts**

Define stable task identifiers, model selection, task creation/prompt/command/shell/interrupt inputs, normalized task events, capability flags, and redacted product errors. Contracts may import published SDK types but may not import Core internals.

- [ ] **Step 2: Test actionable error categories**

Cover unreachable endpoint, authentication, incompatible API, missing model, streaming, tool calling, timeout, TLS, server crash, aborted request, and unknown failures. Assert that authorization values and obvious API-key formats are redacted.

- [ ] **Step 3: Implement normalization and capability reporting**

Keep raw errors available only behind an explicitly redacted diagnostic field. Expose capability flags for retained OpenCode features so Phase 3 can map them into Advanced mode.

- [ ] **Step 4: Export the public product surface and verify**

```bash
export PATH="$HOME/.bun/bin:$PATH"
(cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/product)
bun run --cwd packages/app typecheck
```

- [ ] **Step 5: Commit the contracts**

```bash
git add packages/app/src/product packages/app/src/index.ts
git commit -m "feat: define product adapter contracts"
```

### Task 4: Route the composer task path through the adapter

**Files:**

- Create: `packages/app/src/product/task-adapter.ts`
- Create: `packages/app/src/product/task-adapter.test.ts`
- Create: `packages/app/src/product/context.tsx`
- Create: `packages/app/src/product/context.test.tsx`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/index.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`

- [ ] **Step 1: Write task-adapter contract tests**

Use a fake `CompatibleApi` session surface. Assert exact mapping for create, prompt, command, shell, and interrupt, including model, agent, variant, attachments, directory, and generated message identifiers.

- [ ] **Step 2: Implement the adapter over `CompatibleApi`**

The adapter owns product naming and error normalization while delegating invocation semantics to OpenCode. It must not copy provider or tool execution logic.

- [ ] **Step 3: Add an injectable product context**

Create a Solid context that derives a directory-scoped adapter from the existing SDK context. Keep a default implementation for browser/test hosts and allow Desktop to add host capabilities without exposing privileged values.

- [ ] **Step 4: Replace direct composer session calls**

Route create, follow-up prompt, slash command, shell, and interrupt calls in `submit.ts` through the task adapter. Worktree creation, optimistic state, navigation, and existing UI behavior remain unchanged.

- [ ] **Step 5: Run focused and existing prompt tests**

```bash
export PATH="$HOME/.bun/bin:$PATH"
(cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/product ./src/components/prompt-input)
bun run --cwd packages/app typecheck
```

- [ ] **Step 6: Commit the adapter wiring**

```bash
git add packages/app/src/product packages/app/src/components/prompt-input/submit.ts packages/app/src/index.ts packages/desktop/src/renderer/index.tsx
git commit -m "feat: route task execution through product adapter"
```

### Task 5: Normalize and lock consumed OpenCode events

**Files:**

- Create: `packages/app/src/product/events.ts`
- Create: `packages/app/src/product/events.test.ts`
- Create: `packages/app/src/product/opencode-contract.test.ts`
- Modify: `packages/app/src/context/server-sdk.tsx`

- [ ] **Step 1: Record required event variants**

Cover session lifecycle, assistant text/reasoning deltas, tool activity, command output, permission requests/replies, questions, file changes, errors, and server status events consumed by the product workflow.

- [ ] **Step 2: Implement normalized timeline mapping**

Add a pure mapping function that preserves the original event identifier and timestamp where available. Unknown events map to a non-fatal advanced event instead of crashing the timeline.

- [ ] **Step 3: Add compile-time and runtime compatibility checks**

Tests must fail when a required `CompatibleApi` method disappears or when a recorded event fixture can no longer be adapted. Reuse `adaptServerEvent` rather than creating a second protocol conversion path.

- [ ] **Step 4: Verify event latency overhead**

Run a deterministic unit benchmark over a representative event batch and assert adapter mapping stays well below the 200 ms product budget.

- [ ] **Step 5: Commit event compatibility**

```bash
git add packages/app/src/product packages/app/src/context/server-sdk.tsx
git commit -m "test: lock product OpenCode contracts"
```

### Task 6: Add a recoverable local sidecar supervisor

**Files:**

- Modify: `packages/desktop/src/main/server.ts`
- Create: `packages/desktop/src/main/sidecar-supervisor.ts`
- Create: `packages/desktop/src/main/sidecar-supervisor.test.ts`
- Modify: `packages/desktop/src/main/index.ts`

- [ ] **Step 1: Expose process completion from `spawnLocalServer`**

Extend `SidecarListener` with an exit promise or equivalent typed completion signal. Preserve existing startup, health, and graceful-stop behavior.

- [ ] **Step 2: Test the supervisor as a pure state machine**

Inject spawn, delay, logger, and clock dependencies. Cover starting, ready, unexpected exit, bounded exponential restart, failed restart, manual restart, graceful stop, concurrent calls, and no restart after app quit.

- [ ] **Step 3: Implement one stable connection lifecycle**

Allocate hostname, port, username, and password once. Restart the sidecar with the same renderer-visible connection values. Publish only sanitized state and a redacted error summary.

- [ ] **Step 4: Integrate with Desktop startup and shutdown**

Replace the V1 global `server` listener in `main/index.ts` with the supervisor. Keep background CLI V2 behavior explicit and do not claim restart support for it until it uses the same contract.

- [ ] **Step 5: Verify lifecycle behavior**

```bash
export PATH="$HOME/.bun/bin:$PATH"
(cd packages/desktop && bun test src/main/server.test.ts src/main/sidecar-supervisor.test.ts src/main/index.test.ts)
bun run --cwd packages/desktop typecheck
```

- [ ] **Step 6: Commit sidecar supervision**

```bash
git add packages/desktop/src/main/server.ts packages/desktop/src/main/sidecar-supervisor.ts packages/desktop/src/main/sidecar-supervisor.test.ts packages/desktop/src/main/index.ts
git commit -m "feat: supervise the local agent server"
```

### Task 7: Expose sanitized desktop-host capabilities through typed IPC

**Files:**

- Create: `packages/desktop/src/product/host.ts`
- Create: `packages/desktop/src/product/host.test.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`

- [ ] **Step 1: Define the cross-platform host interface**

Expose sidecar status get/subscribe/restart and credential capability metadata. Phase 1 defines credential operations and namespace ownership but does not store secrets; macOS Keychain implementation is Phase 2.

- [ ] **Step 2: Test the IPC allow list and redaction**

Assert status payloads contain state, attempt, timestamps, and redacted errors but never URL credentials, passwords, authorization headers, or raw environment values.

- [ ] **Step 3: Register lifecycle IPC and subscriptions**

Use renderer-scoped subscription cleanup matching the updater pattern. Make manual restart idempotent and return sanitized state.

- [ ] **Step 4: Inject the Desktop product host**

Wrap `AppInterface` with the product host provider. Browser/test defaults remain functional and future Windows implementations can satisfy the same interface.

- [ ] **Step 5: Verify preload and renderer boundaries**

```bash
export PATH="$HOME/.bun/bin:$PATH"
(cd packages/desktop && bun test src/product src/main src/preload src/renderer)
bun run --cwd packages/desktop typecheck
```

- [ ] **Step 6: Commit typed host IPC**

```bash
git add packages/desktop/src/product packages/desktop/src/main/ipc.ts packages/desktop/src/preload packages/desktop/src/renderer/index.tsx packages/desktop/src/main/index.ts
git commit -m "feat: expose typed desktop product host"
```

### Task 8: Add product CI and complete the Phase 1 gate

**Files:**

- Create: `.github/workflows/product.yml`
- Create: `docs/product/phase-1/verification.md`
- Update: `docs/product/baseline/feature-parity.md`
- Update: this plan's checkboxes

- [ ] **Step 1: Add focused pull-request CI**

The workflow installs Bun 1.3.14 with the frozen lockfile and runs lint, App/Desktop type checks, product contract tests, all Desktop tests, and the Desktop build. Use a reproducible models.dev snapshot or checked script input; do not rely on an unpinned live API response.

- [ ] **Step 2: Run the local Phase 1 gate**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run lint
bun run --cwd packages/app typecheck
bun run --cwd packages/desktop typecheck
(cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/product ./src/components/prompt-input)
(cd packages/desktop && bun test src)
MODELS_DEV_API_JSON=/tmp/models-dev-audit.2X2ZYe/packages/web/dist/_api.json OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

Expected: every command exits 0.

- [ ] **Step 3: Package and smoke test the isolated development app**

Build an unsigned macOS directory package, launch it against a temporary Git repository, execute a deterministic unchanged OpenCode task through the product adapter, kill the sidecar process, confirm automatic recovery, and confirm the same task remains available. Record screenshots, health output, status transitions, and accessibility findings.

- [ ] **Step 4: Re-run the capability and boundary checks**

```bash
git diff --exit-code v1.18.10...HEAD -- packages/core packages/opencode packages/server packages/protocol
git diff --check
git status --short
```

Expected: protected runtime packages are unchanged; only the pre-existing `.superpowers/` directory may remain untracked.

- [ ] **Step 5: Document evidence and remaining Phase 2 dependencies**

Record exact commands, counts, artifacts, known warnings, sidecar recovery timings, identity paths, and the credential interface that Phase 2 must implement.

- [ ] **Step 6: Obtain independent specification and quality reviews**

Both reviews must return `APPROVED`; otherwise fix findings and repeat the affected gate.

- [ ] **Step 7: Commit Phase 1 completion evidence**

```bash
git add .github/workflows/product.yml docs/product/phase-1 docs/product/baseline/feature-parity.md docs/superpowers/plans/2026-08-01-thin-fork-foundation.md
git commit -m "docs: complete phase 1 thin-fork foundation"
```

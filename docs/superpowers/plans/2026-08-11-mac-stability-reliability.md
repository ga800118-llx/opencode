# Mac Stability and Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five reported Mac desktop reliability and usability failures without replacing the existing front-end state architecture.

**Architecture:** Keep the existing Solid stores, Server Sync, TanStack Query, and tab model. Add three bounded mechanisms: system-managed model runtime policy plus a presentation-only activity watchdog, a deduplicated workspace-readiness boundary before draft creation, and explicit Skill source/query refresh. Project metadata and session compaction each gain one shared operation so V1/V2 and all UI entry points use the same behavior.

**Tech Stack:** TypeScript, SolidJS, TanStack Solid Query, Effect, Bun test, Happy DOM, Playwright, Electron, electron-builder.

---

## File Map

### Model runtime policy

- `packages/app/src/product/model-center/contracts.ts`: accept legacy timeout data while removing it from current settings.
- `packages/app/src/product/model-center/contracts.test.ts`: migration and validation coverage.
- `packages/app/src/product/model-center/config.ts`: serialize runtime timeouts as disabled.
- `packages/app/src/product/model-center/config.test.ts`: provider config assertions.
- `packages/app/src/product/model-center/controller.test.ts`: update profile fixtures to the migrated settings shape.
- `packages/app/src/components/settings-v2/model-center-controller.ts`: remove timeout form state and use current settings shape.
- `packages/app/src/components/settings-v2/model-center-controller.test.ts`: form migration and discovery invalidation coverage.
- `packages/app/src/components/settings-v2/dialog-model-profile.tsx`: remove visible timeout input.
- `packages/app/src/components/settings-v2/model-center.tsx`: copy disabled runtime timeout fields into OpenCode config.
- `packages/desktop/src/main/model-center/probe.ts`: own the internal 30-second probe policy.
- `packages/desktop/src/main/model-center/service.ts`: use the internal probe timeout instead of profile settings.
- `packages/desktop/src/main/model-center/service.test.ts`: verify system-managed probe targets.
- `packages/desktop/src/main/model-center/{profiles,e2e-secrets,environment}.test.ts`: update persisted-profile fixtures and migration expectations.
- `packages/desktop/src/main/model-center/credential-proxy.ts`: stop applying probe timeout to runtime streams.
- `packages/desktop/src/main/model-center/credential-proxy.test.ts`: long/silent stream coverage.
- `packages/llm/src/route/transport/http.ts`: prevent timeout control fields from becoming model JSON body overlays.
- `packages/llm/test/prepare.test.ts`: V2 body-projection regression coverage.

### Activity watchdog

- `packages/app/src/context/server-session.ts`: record last meaningful session activity.
- `packages/app/src/context/server-session.test.ts`: V1/V2 activity event coverage.
- `packages/app/src/context/global-sync/types.ts`: expose activity timestamps through directory sync state.
- `packages/app/src/context/global-sync/child-store.ts`: initialize the activity field for type completeness.
- `packages/app/src/context/directory-sync.ts`: project activity from the process-global session store.
- `packages/app/src/pages/session/timeline/activity-watchdog.ts`: pure activity-state projection.
- `packages/app/src/pages/session/timeline/activity-watchdog.test.ts`: threshold and virtual eight-hour tests.
- `packages/app/src/pages/session/timeline/message-timeline.tsx`: display slow/unverified state without stopping execution.
- `packages/ui/src/i18n/{en,ar,br,bs,da,de,es,fr,ja,ko,no,pl,ru,th,tr,uk,zh,zht}.ts`: localized slow/unverified process labels.

### Project metadata

- `packages/app/src/context/project-metadata.ts`: merge and persist project metadata through one boundary.
- `packages/app/src/context/project-metadata.test.ts`: merge precedence and V1/V2 persistence tests.
- `packages/app/src/components/edit-project.ts`: call the shared persistence operation and retain errors.
- `packages/app/src/components/dialog-edit-project.tsx`: render save failure without closing.
- `packages/app/src/components/dialog-edit-project-v2.tsx`: render save failure without closing.
- `packages/app/src/context/global.tsx`: merge local metadata into all server project projections.
- `packages/app/src/context/layout.tsx`: use the same merge/persistence operation for rename and automatic color.

### Workspace readiness

- `packages/app/src/context/global-sync/bootstrap.ts`: return awaited critical and non-critical initialization results.
- `packages/app/src/context/server-sync.tsx`: deduplicate readiness by scope and normalized directory.
- `packages/app/src/context/server-sync.test.ts`: ready/degraded/failed/retry tests.
- `packages/app/src/context/tabs.tsx`: gate every draft creation on readiness and deduplicate repeated clicks.
- `packages/app/src/context/tabs.test.ts`: no-draft-before-ready and retry coverage.
- `packages/app/src/pages/home/home-controller.ts`: expose pending state to the Home new-task action.
- `packages/app/src/components/titlebar.tsx`: disable repeated new-tab commands while readiness is pending.

### Skill refresh

- `packages/core/src/skill.ts`: reload source topology before management snapshots while retaining remote cache.
- `packages/core/test/skill.test.ts`: discover a directory Skill added after the first non-empty snapshot.
- `packages/app/src/components/settings-v2/skills-controller.ts`: visible polling lifecycle helper.
- `packages/app/src/components/settings-v2/skills-controller.test.ts`: mount/focus/visibility/poll/unmount coverage.
- `packages/app/src/components/settings-v2/skills.tsx`: refetch lifecycle, stale-data error behavior, and manual refresh button.
- `packages/app/test-browser/settings-skills-harness.ts`: external-install and failed-refresh browser fixture.
- `packages/app/test-browser/settings-skills.test.ts`: visible-page automatic refresh coverage.

### Context usage and compaction

- `packages/app/src/pages/session/session-compaction.ts`: shared, deduplicated compaction action.
- `packages/app/src/pages/session/session-compaction.test.ts`: model, busy, success, and failure coverage.
- `packages/app/src/pages/session/use-session-commands.tsx`: call the shared action from `/compact`.
- `packages/app/src/components/session-context-usage.tsx`: remove cost from tooltip.
- `packages/app/src/components/session/session-context-tab.tsx`: remove total cost and add the compact control.

### End-to-end and packaged verification

- `packages/app/e2e/regression/model-runtime-reliability.spec.ts`: no short runtime abort and watchdog presentation.
- `packages/app/e2e/regression/project-edit-persistence.spec.ts`: project name/color persistence.
- `packages/app/e2e/regression/context-compact.spec.ts`: cost removal and compact button.
- `packages/app/e2e/regression/skill-refresh.spec.ts`: open-page external Skill discovery.
- `packages/app/e2e/regression/new-project-immediate-task.spec.ts`: add-project/new-task race and retry.
- `packages/desktop/scripts/mac-runtime-soak.ts`: deterministic 65-minute packaged-app runtime fixture and evidence.
- `packages/desktop/scripts/mac-runtime-soak.test.ts`: evidence schema and failure detection.
- `docs/testing/mac-stability-verification.md`: exact packaged Mac verification evidence.

---

### Task 1: System-Managed Model Runtime Policy

**Files:**
- Modify all files listed under “Model runtime policy”.

- [ ] **Step 1: Write failing contract and serialization tests**

Add cases equivalent to:

```ts
test("migrates legacy timeout without retaining a runtime limit", () => {
  const result = normalizeProviderProfileInput({
    ...input,
    settings: { ...input.settings, timeoutMs: 30_000 },
  })
  expect(result.settings).toEqual({ contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false })
})

test("disables app-imposed runtime timeouts", () => {
  expect(serializeProviderProfile(profile).options).toMatchObject({
    timeout: false,
    headerTimeout: false,
  })
})
```

- [ ] **Step 2: Run the failing model-center tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts \
  src/product/model-center/contracts.test.ts \
  src/product/model-center/config.test.ts \
  src/components/settings-v2/model-center-controller.test.ts
```

Expected: failures mentioning retained `timeoutMs`, numeric provider timeout, and timeout form state.

- [ ] **Step 3: Migrate settings and remove the timeout input**

Use this current shape:

```ts
export type ProductProviderSettings = {
  readonly contextLimit: number
  readonly outputLimit: number
  readonly proxyURL?: string
  readonly allowInsecureTls: false
}
```

When normalizing old data, validate a present legacy `timeoutMs` only to reject corrupt persisted data, then omit it from the returned object. Remove `timeoutMs` from controller state, `setSetting`, discovery invalidation, and `dialog-model-profile.tsx`.

Update every persisted-profile fixture reported by:

```bash
rg -l "timeoutMs" packages/app/src/product/model-center packages/app/src/components/settings-v2 packages/desktop/src/main/model-center
```

Keep `timeoutMs` only in probe/http/local-detection types where it represents an internal diagnostic timeout, never in `ProductProviderSettings`.

- [ ] **Step 4: Separate probe and runtime policies**

Export an internal constant from `probe.ts`:

```ts
export const MODEL_PROBE_TIMEOUT_MS = 30_000
```

Use that value in `service.ts` for discovery and capability targets. Serialize runtime options as:

```ts
options: Object.freeze({
  baseURL: providerBaseURL(profile),
  timeout: false as const,
  headerTimeout: false as const,
  ...(Object.keys(headers).length ? { headers: Object.freeze(headers) } : {}),
})
```

Do not set a chunk timeout. Remove `upstream.setTimeout(profile.settings.timeoutMs, ...)` from the credential proxy. Preserve explicit user/app cancellation signals.

- [ ] **Step 5: Protect the V2 request body**

Add `timeout` and `timeoutMs` to `PROTOCOL_BODY_OVERLAY_DENYLIST` in `packages/llm/src/route/transport/http.ts`. Add a `prepare.test.ts` case proving either field fails as a protocol-owned body overlay and is not present in the serialized JSON body.

- [ ] **Step 6: Add desktop proxy and probe tests**

Test that profile values cannot alter the internal probe timeout and that a proxy request remains connected after the old timeout interval while upstream is still open. Use a short test clock/fixture interval; do not sleep for 30 seconds.

- [ ] **Step 7: Run task verification**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/product/model-center src/components/settings-v2/model-center-controller.test.ts
bun typecheck

cd ../desktop
bun test src/main/model-center/probe.test.ts src/main/model-center/service.test.ts src/main/model-center/credential-proxy.test.ts
bun typecheck

cd ../llm
bun test test/prepare.test.ts test/executor.test.ts
bun typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/product/model-center packages/app/src/components/settings-v2/model-center-controller.ts packages/app/src/components/settings-v2/model-center-controller.test.ts packages/app/src/components/settings-v2/dialog-model-profile.tsx packages/app/src/components/settings-v2/model-center.tsx packages/desktop/src/main/model-center packages/llm/src/route/transport/http.ts packages/llm/test/prepare.test.ts
git commit -m "fix(app): remove model runtime deadline"
```

### Task 2: Activity Watchdog and Long-Running Status

**Files:**
- Modify/create all files listed under “Activity watchdog”.

- [ ] **Step 1: Write the pure watchdog tests**

Create `activity-watchdog.test.ts` with table cases for:

```ts
expect(projectActivity({ working: false, now: 1_000, lastActivityAt: 0, toolRunning: false })).toBe("idle")
expect(projectActivity({ working: true, now: 179_999, lastActivityAt: 0, toolRunning: false })).toBe("active")
expect(projectActivity({ working: true, now: 180_000, lastActivityAt: 0, toolRunning: false })).toBe("slow")
expect(projectActivity({ working: true, now: 600_000, lastActivityAt: 0, toolRunning: false })).toBe("unverified")
expect(projectActivity({ working: true, now: 8 * 60 * 60_000, lastActivityAt: 0, toolRunning: true })).toBe("active")
```

- [ ] **Step 2: Run the failing watchdog test**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/activity-watchdog.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement the pure projection**

```ts
export type SessionActivityState = "idle" | "active" | "slow" | "unverified"

export function projectActivity(input: {
  working: boolean
  now: number
  lastActivityAt: number
  toolRunning: boolean
}): SessionActivityState {
  if (!input.working) return "idle"
  if (input.toolRunning) return "active"
  const idle = Math.max(0, input.now - input.lastActivityAt)
  if (idle < 3 * 60_000) return "active"
  if (idle < 10 * 60_000) return "slow"
  return "unverified"
}
```

- [ ] **Step 4: Record meaningful activity in ServerSession**

Add `session_activity: Record<string, number>` to server-session data and directory state. Mark activity from legacy events via `eventSessionID(event)` and V2 events via `event.data.sessionID`; use event timestamps where available and `Date.now()` otherwise. Mark optimistic prompt admission. Delete activity when a session is evicted.

Do not create a cancellation timer. The watchdog is presentation-only.

- [ ] **Step 5: Add event reducer tests**

Cover V1 `message.part.updated`, V1 `session.status`, V2 `session.text.delta`, V2 `session.tool.*`, execution completion, and eviction. Assert activity changes only for the affected session.

- [ ] **Step 6: Render slow and unverified labels**

In `message-timeline.tsx`, derive `toolRunning` from assistant tool parts whose state is running. Keep the existing elapsed duration and add:

- slow: “Response is slow; still waiting” / “响应较慢，仍在等待”;
- unverified: “Activity cannot be confirmed; task is still running” / “暂时无法确认活动，任务仍在继续”.

Add both keys to every UI locale listed in the File Map, preserving parity. Do not add a Continue button and do not alter the Stop action.

- [ ] **Step 7: Run task verification**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/pages/session/timeline/activity-watchdog.test.ts \
  src/context/server-session.test.ts \
  src/i18n/parity.test.ts
bun typecheck
```

Expected: all pass, including virtual eight-hour active-tool coverage.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/context packages/app/src/pages/session/timeline packages/ui/src/i18n
git commit -m "feat(app): show long-running task health"
```

### Task 3: Unified Project Metadata Persistence

**Files:**
- Modify/create all files listed under “Project metadata”.

- [ ] **Step 1: Write merge and persistence tests**

Cover nested icon merging and protocol behavior:

```ts
expect(mergeProjectMetadata(
  { name: "server", icon: { url: "server.png", color: "blue" }, commands: { start: "old" } },
  { name: "local", icon: { color: "mint" }, commands: { start: "bun dev" } },
)).toMatchObject({ name: "local", icon: { url: "server.png", color: "mint" }, commands: { start: "bun dev" } })
```

Test V1 server success + local mirror, V1 error without local write, V2 local write without server call, and global local write.

- [ ] **Step 2: Run the failing tests**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/context/project-metadata.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement the shared boundary**

Create one operation accepting protocol, project, patch, `updateServer`, `writeLocal`, and `updateProjection`. V1 updates server first and mirrors locally only after success. V2/global write locally. Return the merged metadata; never silently return on protocol.

- [ ] **Step 4: Use it from every write path**

Replace protocol branches in `edit-project.ts`, `layout.tsx` rename, and automatic color assignment. Update `global.tsx` and `layout.tsx` project enrichment so merge precedence is server metadata, then `childStore.projectMeta`, then worktree/expanded identity. Preserve `childStore.icon` as the final image override.

- [ ] **Step 5: Preserve save errors in both dialogs**

Expose `save.error` from the mutation. Render an inline error region with `role="alert"`; close only after the mutation resolves. Disable submit while pending.

- [ ] **Step 6: Run task verification**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/context/project-metadata.test.ts \
  src/context/global-sync/child-store.test.ts \
  src/utils/server-compat.test.ts
bun typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/context/project-metadata.ts packages/app/src/context/project-metadata.test.ts packages/app/src/context/global.tsx packages/app/src/context/layout.tsx packages/app/src/components/edit-project.ts packages/app/src/components/dialog-edit-project.tsx packages/app/src/components/dialog-edit-project-v2.tsx
git commit -m "fix(app): persist project metadata"
```

### Task 4: Workspace Readiness Before Draft Creation

**Files:**
- Modify all files listed under “Workspace readiness”.

- [ ] **Step 1: Write readiness-state tests**

Add cases proving:

- two concurrent `ensureReady(directory)` calls share one bootstrap;
- critical project/path/config failure returns `failed` and a second call retries;
- provider/session-history failure returns `degraded`;
- successful bootstrap returns `ready`;
- already-ready directories avoid another request.

- [ ] **Step 2: Run the failing sync tests**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/context/server-sync.test.ts src/context/tabs.test.ts
```

Expected: no readiness API and draft is created before bootstrap settles.

- [ ] **Step 3: Make bootstrap completion awaitable**

Change `bootstrapDirectory(...)` to await its scheduled slow work and return a result:

```ts
type WorkspaceBootstrapResult = {
  status: "ready" | "degraded"
  errors: readonly Error[]
}
```

Classify project identity, path, and config as critical. Classify provider, history, references, MCP, LSP, permission hydration, and optional UI resources as non-critical. Critical errors reject; non-critical errors resolve `degraded` and keep existing toasts.

- [ ] **Step 4: Add deduplicated readiness to ServerSync**

Maintain a map keyed by `ScopedKey.from(scope, directoryKey(directory))`. Expose:

```ts
project: {
  ensureReady(directory: string): Promise<"ready" | "degraded">
  readiness(directory: string): "initializing" | "ready" | "degraded" | "failed"
}
```

Clear a failed Promise so the next call retries. Retain ready/degraded state for the child-store lifetime.

- [ ] **Step 5: Gate and deduplicate `tabs.newDraft`**

Resolve the server through `useGlobal()`, call `ctx.sync.project.ensureReady(directory)`, and create the draft only after it resolves. Keep an in-flight map keyed by server + normalized directory so repeated clicks return the same pending draft and create one tab. On failure, show a product error toast and create no tab.

- [ ] **Step 6: Expose pending UI state**

Home and titlebar actions read `tabs.draftPending(server, directory)` to disable repeated commands and show existing loading treatment. Do not require each caller to invoke readiness itself; `tabs.newDraft` remains the invariant.

- [ ] **Step 7: Run task verification**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/context/server-sync.test.ts \
  src/context/tabs.test.ts \
  src/pages/new-session/new-session-workspace-controller.test.ts
bun typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/context/global-sync/bootstrap.ts packages/app/src/context/server-sync.tsx packages/app/src/context/server-sync.test.ts packages/app/src/context/tabs.tsx packages/app/src/context/tabs.test.ts packages/app/src/pages/home/home-controller.ts packages/app/src/components/titlebar.tsx
git commit -m "fix(app): await new project readiness"
```

### Task 5: Skill Source and Query Refresh

**Files:**
- Modify all files listed under “Skill refresh”.

- [ ] **Step 1: Write the Core refresh regression**

Within one Skill service lifetime:

1. create one valid directory Skill;
2. call `management.list()` and assert one record;
3. create a second valid Skill on disk;
4. call `management.list()` again and assert both records;
5. register a new source transform, call again, and assert the source topology is rebuilt.

- [ ] **Step 2: Run the failing Core test**

```bash
cd packages/core
bun test test/skill.test.ts
```

Expected: the new topology/source case fails before reload is added.

- [ ] **Step 3: Reload source topology at the management boundary**

Call `state.reload()` before `installed()` in `managementList`. Directory sources continue to scan every call. Keep the existing non-directory `cache` so 2-second UI refreshes do not pull remote sources repeatedly. Clear a removed source cache entry as today.

- [ ] **Step 4: Write the front-end lifecycle tests**

Use injected timers/document visibility to test:

- refetch on mount;
- refetch on focus and hidden-to-visible transition;
- one refetch per 2-second visible interval;
- no interval while hidden;
- disposal cancels timers;
- failed refetch leaves the prior list available.

- [ ] **Step 5: Implement visible polling and manual refresh**

Keep the query key `[scope, directory, "skill-management"]`. Use `refetchOnMount: "always"`, explicit focus/visibility listeners, and `refetchInterval: 2_000` only while `document.visibilityState === "visible"`. Add an icon-only refresh button with tooltip and `aria-label`; disable it while fetching.

- [ ] **Step 6: Add browser coverage for an external install**

Extend the harness so the first two list responses contain one Skill and the next response contains a second Skill without a page mutation. Assert the second row appears while the page remains open. Add a failed-refresh case that retains the first row.

- [ ] **Step 7: Run task verification**

```bash
cd packages/core
bun test test/skill.test.ts
bun typecheck

cd ../app
bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2/skills-controller.test.ts src/utils/skill-management-api.test.ts
bun test --conditions=browser --preload ./happydom.ts ./test-browser/settings-skills.test.ts
bun typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill.ts packages/core/test/skill.test.ts packages/app/src/components/settings-v2/skills-controller.ts packages/app/src/components/settings-v2/skills-controller.test.ts packages/app/src/components/settings-v2/skills.tsx packages/app/test-browser/settings-skills-harness.ts packages/app/test-browser/settings-skills.test.ts
git commit -m "fix(app): refresh installed skills"
```

### Task 6: Context Cost Removal and Shared Compaction

**Files:**
- Modify/create all files listed under “Context usage and compaction”.

- [ ] **Step 1: Write the shared compaction tests**

Test a pure controller/action with injected accessors and API:

- no session: disabled, no request;
- no visible user message: disabled;
- no model: report the existing no-model feedback;
- working session: disabled;
- two concurrent calls: one API request;
- success: success result and pending resets;
- failure: error result, pending resets, context remains unchanged;
- request contains the exact sessionID, providerID, and modelID.

- [ ] **Step 2: Run the failing test**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts src/pages/session/session-compaction.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement and reuse one action**

Create `createSessionCompaction(...)` with `pending`, `disabledReason`, and `run()`. Move the API call and model guard out of `use-session-commands.tsx`. The slash command and context tab instantiate/use the same action contract; do not duplicate request construction.

Store the in-flight request in a module-level map keyed by sessionID so invoking the slash command and clicking the button concurrently still sends one compaction request.

- [ ] **Step 4: Remove all visible cost formatting**

Delete the USD formatter, cost memo, and cost row from `session-context-usage.tsx`. Delete `context.stats.totalCost` from the details stats. Leave session cost data untouched elsewhere.

- [ ] **Step 5: Add the compact control**

Add a compact button near the context statistics using an existing UI icon. Use `command.session.compact` and `command.session.compact.description` for label/tooltip. Disable it for the action reasons, show loading while pending, and show existing product toast patterns for success/error.

- [ ] **Step 6: Run task verification**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/pages/session/session-compaction.test.ts \
  src/components/session/session-context-breakdown.test.ts \
  src/components/session/session-context-metrics.test.ts
bun typecheck
```

Expected: all pass and `rg -n 'usage.cost|stats.totalCost'` finds no render use in the two context components.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/pages/session/session-compaction.ts packages/app/src/pages/session/session-compaction.test.ts packages/app/src/pages/session/use-session-commands.tsx packages/app/src/components/session-context-usage.tsx packages/app/src/components/session/session-context-tab.tsx
git commit -m "feat(app): add context compaction control"
```

### Task 7: Browser End-to-End Regression Matrix

**Files:**
- Create the five Playwright files listed under “End-to-end and packaged verification”.

- [ ] **Step 1: Build deterministic route fixtures**

Follow existing `packages/app/e2e/regression` route stubs. Each test must start from isolated localStorage and mock server state. Do not rely on a real third-party model.

- [ ] **Step 2: Cover each user-visible regression**

- model: no timeout field; a mocked stream remains busy beyond the old deadline and watchdog labels change via virtual page clock/events without cancellation;
- project: edit name/color, close dialog, remount page with persisted storage, verify values;
- context: tooltip/details contain no cost, compact button sends one correct request and updates usage fixture;
- Skill: keep page open, return a new Skill on polling, verify stale data survives a failed refresh;
- project race: add a project, immediately click New Task twice, bootstrap resolves once, exactly one draft opens; first bootstrap failure is retryable.

- [ ] **Step 3: Run E2E typecheck and tests**

```bash
cd packages/app
bun run typecheck:e2e
bunx playwright test \
  e2e/regression/model-runtime-reliability.spec.ts \
  e2e/regression/project-edit-persistence.spec.ts \
  e2e/regression/context-compact.spec.ts \
  e2e/regression/skill-refresh.spec.ts \
  e2e/regression/new-project-immediate-task.spec.ts
```

Expected: five files pass on Chromium.

- [ ] **Step 4: Commit**

```bash
git add packages/app/e2e/regression
git commit -m "test(app): cover mac stability regressions"
```

### Task 8: Full Verification, Mac Package, and 65-Minute Soak

**Files:**
- Create `packages/desktop/scripts/mac-runtime-soak.ts`.
- Create `packages/desktop/scripts/mac-runtime-soak.test.ts`.
- Create `docs/testing/mac-stability-verification.md`.

- [ ] **Step 1: Add deterministic soak evidence**

The fixture must expose an OpenAI-compatible endpoint that emits authenticated SSE activity at a configurable interval and records start, chunk count, elapsed time, disconnect reason, and completion. The default packaged verification duration is `65 * 60_000`; tests inject a short duration.

Evidence JSON must include:

```ts
type MacRuntimeSoakEvidence = {
  startedAt: string
  completedAt: string
  requestedDurationMs: number
  observedDurationMs: number
  chunks: number
  clientAbort: false
  completed: true
}
```

- [ ] **Step 2: Test the verifier itself**

Assert it rejects duration below the request, zero chunks, client abort, incomplete streams, and malformed evidence; assert it accepts a valid short fixture run.

- [ ] **Step 3: Run all package test suites and typechecks**

```bash
cd packages/app
bun run test:unit
bun run test:browser
bun run typecheck
bun run typecheck:e2e

cd ../core
bun test
bun typecheck

cd ../llm
bun test
bun typecheck

cd ../opencode
bun test
bun typecheck

cd ../desktop
bun test
bun typecheck
bun run build
```

Expected: all pass. Record exact counts and any intentionally skipped tests in the verification document.

- [ ] **Step 4: Build the internal Mac package**

```bash
cd packages/desktop
bun run package:mac:internal
```

Expected: signed-ad-hoc internal package artifacts are produced without using the source dev server.

- [ ] **Step 5: Run packaged-app UI regression**

Use the packaged application with clean data and upgraded alpha data. Verify model setup, project persistence, immediate New Task, Skill refresh, cost removal, and compaction. Capture screenshots/logs and record artifact paths and hashes in `docs/testing/mac-stability-verification.md`.

- [ ] **Step 6: Run the 65-minute active stream soak**

Run the packaged app against the deterministic fixture for at least 65 minutes. Evidence must show ongoing chunks, no client abort, and normal completion. Also run a short silent-stream scenario and verify the UI warns but does not stop the request.

- [ ] **Step 7: Independent completion audit**

An independent test Agent must map every design requirement to test output, package evidence, screenshot/log evidence, or source inspection. Any missing or indirect evidence keeps the goal open.

- [ ] **Step 8: Commit verification artifacts**

```bash
git add packages/desktop/scripts/mac-runtime-soak.ts packages/desktop/scripts/mac-runtime-soak.test.ts docs/testing/mac-stability-verification.md
git commit -m "test(desktop): verify mac stability release"
```

---

## Agent Execution Roles

- **Coordinator:** current task; owns plan status, conflict prevention, integration, and final completion audit.
- **Implementer:** one fresh Agent per task, given only that task and its exact write set.
- **Spec reviewer:** a different Agent checks the completed task against the design and task acceptance criteria.
- **Code-quality reviewer:** a different Agent reviews correctness, maintainability, error handling, and test quality after spec approval.
- **Test lead:** independent Agent runs the cross-package, Playwright, package, and soak matrix and challenges weak evidence.

Implementation tasks run sequentially to prevent shared-state conflicts. Read-only review and verification may run in parallel with non-overlapping coordinator work.

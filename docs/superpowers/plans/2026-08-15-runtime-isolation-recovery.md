# Runtime Isolation and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed Mac and Windows builds use deterministic, product-owned model and session state, recover cleanly after sidecar restarts, and identify the exact tested build.

**Architecture:** Derive all embedded OpenCode runtime roots from Electron `userData`, then pass an authoritative generated model overlay to the sidecar before the OpenCode runtime is imported. Keep the existing encrypted model-profile store as the source of truth, reconcile renderer session state on every reconnect, and stamp both desktop packages with version `0.1.0-alpha.3` plus one source revision.

**Tech Stack:** Electron, Bun, TypeScript, SolidJS, TanStack Query, electron-vite, electron-builder, GitHub Actions.

---

## File Map

- Create `packages/desktop/src/main/runtime-environment.ts`: derive and create isolated sidecar paths and environment values.
- Create `packages/desktop/src/main/runtime-environment.test.ts`: verify packaged/dev/onboarding isolation behavior.
- Create `packages/desktop/src/main/model-center/runtime-config.ts`: build and atomically write the product model overlay and migration manifest.
- Create `packages/desktop/src/main/model-center/runtime-config.test.ts`: verify exact provider/default serialization and orphan removal.
- Modify `packages/desktop/src/main/index.ts`: initialize runtime files before the sidecar and refresh them before controlled restart.
- Modify `packages/desktop/src/main/server.ts`: stop deriving sidecar persistence from inherited global XDG paths.
- Modify `packages/desktop/src/main/sidecar.ts`: require the complete runtime environment before importing the server bundle.
- Modify `packages/desktop/src/main/server.test.ts`: assert that every sidecar receives the isolated environment.
- Modify `packages/app/src/product/model-center/controller.ts`: remove renderer-side OpenCode config writes for product profiles.
- Modify `packages/app/src/product/model-center/controller.test.ts`: verify profile operations refresh the authoritative runtime once.
- Modify `packages/app/src/components/settings-v2/model-center.tsx`: use the simplified controller contract.
- Modify `packages/app/src/context/server-sync.tsx`: reconcile active and visible sessions on every reconnect.
- Modify `packages/app/src/context/server-sync.test.ts`: cover completed, failed, and still-running reconnect states.
- Modify `packages/app/src/context/platform.tsx`: expose an optional desktop build revision.
- Modify `packages/desktop/src/renderer/index.tsx`: populate the revision compiled into the package.
- Modify `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`: display the short revision next to the version.
- Modify `packages/desktop/electron.vite.config.ts`: define the build revision for renderer compilation.
- Modify `packages/desktop/src/main/env.d.ts`: type the compile-time build revision.
- Modify `packages/desktop/package.json`: bump the repaired internal build to `0.1.0-alpha.3`.
- Modify `.github/workflows/windows-internal-beta.yml`: enforce the new version and pass the source revision into the build.
- Modify `packages/desktop/scripts/package-internal-mac.ts`: pass source revision into the isolated Mac build.
- Modify affected package/build tests: update assertions that intentionally track the current release version or metadata.

### Task 1: Isolate the Embedded Runtime

**Files:**
- Create: `packages/desktop/src/main/runtime-environment.ts`
- Create: `packages/desktop/src/main/runtime-environment.test.ts`
- Modify: `packages/desktop/src/main/server.ts`
- Modify: `packages/desktop/src/main/sidecar.ts`
- Modify: `packages/desktop/src/main/server.test.ts`

- [x] **Step 1: Write failing path-policy tests**

Add tests that call a pure `createDesktopRuntimeEnvironment` function with a temporary `userDataPath` and inherited values pointing at `~/.config/opencode`, `~/.local/share/opencode`, and a test database. Assert the result replaces all persistence locations:

```ts
expect(environment).toMatchObject({
  XDG_CONFIG_HOME: path.join(userDataPath, "runtime", "config"),
  XDG_DATA_HOME: path.join(userDataPath, "runtime", "data"),
  XDG_CACHE_HOME: path.join(userDataPath, "runtime", "cache"),
  XDG_STATE_HOME: path.join(userDataPath, "runtime", "state"),
  OPENCODE_DB: path.join(userDataPath, "runtime", "data", "opencode.db"),
})
expect(environment.OPENCODE_CONFIG).toBe(path.join(userDataPath, "runtime", "config", "model-profiles.json"))
```

Also assert an explicit onboarding root produces paths under that root and never under the real Electron `userData` directory.

- [x] **Step 2: Run the tests to confirm the API is missing**

Run: `bun test ./src/main/runtime-environment.test.ts ./src/main/server.test.ts` from `packages/desktop`.

Expected: FAIL because `createDesktopRuntimeEnvironment` and the full sidecar environment integration do not exist.

- [x] **Step 3: Implement the pure runtime policy**

Create one focused module with this public shape:

```ts
export type DesktopRuntimePaths = {
  readonly root: string
  readonly config: string
  readonly data: string
  readonly cache: string
  readonly state: string
  readonly database: string
  readonly modelConfig: string
  readonly manifest: string
  readonly migrationMarker: string
}

export function createDesktopRuntimePaths(userDataPath: string): DesktopRuntimePaths

export function createDesktopRuntimeEnvironment(
  paths: DesktopRuntimePaths,
  inherited?: Readonly<Record<string, string | undefined>>,
): Record<string, string>

export async function ensureDesktopRuntime(paths: DesktopRuntimePaths): Promise<void>
```

`createDesktopRuntimeEnvironment` must preserve unrelated shell values but overwrite `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `OPENCODE_DB`, and `OPENCODE_CONFIG`. `ensureDesktopRuntime` creates all four roots with `fs/promises.mkdir({ recursive: true })`.

- [x] **Step 4: Pass the explicit environment to every local sidecar**

In `index.ts`, derive paths immediately after `app.setPath("userData", ...)`, create them before sidecar startup, and merge their environment with the bundled Git and credential environments passed to `spawnLocalServer`.

Keep `preferAppEnv` responsible only for loading the interactive shell and enabling desktop feature flags. Remove its fallback assignment to `XDG_STATE_HOME`.

In `sidecar.ts`, make `prepareSidecarEnv` validate that all six persistence variables already exist, then set only server username/password. This preserves the critical invariant that the virtual OpenCode server is imported only after the isolated environment is installed.

- [x] **Step 5: Verify isolation tests and type checking**

Run from `packages/desktop`:

```bash
bun test ./src/main/runtime-environment.test.ts ./src/main/server.test.ts ./src/main/sidecar-supervisor.test.ts
bun typecheck
```

Expected: all selected tests pass and typecheck exits 0.

- [x] **Step 6: Commit runtime isolation**

```bash
git add packages/desktop/src/main/runtime-environment.ts packages/desktop/src/main/runtime-environment.test.ts packages/desktop/src/main/server.ts packages/desktop/src/main/server.test.ts packages/desktop/src/main/sidecar.ts packages/desktop/src/main/index.ts
git commit -m "fix(desktop): isolate embedded runtime state"
```

### Task 2: Generate an Authoritative Model Overlay

**Files:**
- Create: `packages/desktop/src/main/model-center/runtime-config.ts`
- Create: `packages/desktop/src/main/model-center/runtime-config.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/main/model-center/service.test.ts`

- [x] **Step 1: Write failing overlay tests**

Use two saved `ProductProviderProfile` fixtures and a fake `presentProfile`. Assert `createProductRuntimeConfig` returns an exact OpenCode config object:

```ts
expect(config.provider).toEqual({
  [first.providerID]: serializeProviderProfile(presentedFirst),
  [second.providerID]: serializeProviderProfile(presentedSecond),
})
expect(config.model).toBe(`${first.providerID}/coder`)
expect(config.disabled_providers).toEqual([])
```

Cover these recovery cases:

- a stored default whose profile or model no longer exists is replaced by the first available profile model;
- no available models omits `model`;
- rewriting a file that contains an orphan provider produces only current providers;
- an interrupted temporary write leaves the previous valid overlay readable;
- the manifest contains path/count/timestamp metadata and no profile headers or credentials.

- [x] **Step 2: Run the focused test and confirm failure**

Run: `bun test ./src/main/model-center/runtime-config.test.ts` from `packages/desktop`.

Expected: FAIL because the overlay module is absent.

- [x] **Step 3: Implement exact config generation and atomic persistence**

Expose this focused API:

```ts
export function createProductRuntimeConfig(input: {
  readonly profiles: readonly ProductProviderProfile[]
  readonly presentProfile: (profile: ProductProviderProfile) => ProductProviderProfile
}): {
  readonly provider: Readonly<Record<string, ProductOpenCodeProviderConfig>>
  readonly disabled_providers: readonly string[]
  readonly model?: string
}

export async function writeProductRuntimeConfig(input: {
  readonly paths: DesktopRuntimePaths
  readonly profiles: readonly ProductProviderProfile[]
  readonly presentProfile: (profile: ProductProviderProfile) => ProductProviderProfile
  readonly now?: () => Date
}): Promise<void>
```

Write JSON to `model-profiles.json.tmp-<pid>-<uuid>`, fsync/close it, and rename it over `model-profiles.json`. Write the migration marker once and replace the nonsensitive manifest on every successful generation. Do not serialize credentials, sensitive header values, or standalone OpenCode providers.

- [x] **Step 4: Integrate startup and controlled refresh**

In `index.ts`, call `writeProductRuntimeConfig` after the credential proxy starts and before the first sidecar starts. Replace the model-center service's `reloadCredentials` callback with:

```ts
await writeProductRuntimeConfig({
  paths: runtimePaths,
  profiles: profileRepository.list(),
  presentProfile: credentialProxy.presentProfile,
})
await restartProductSidecar()
```

This makes startup, save, remove, and default selection converge on one exact file. Log only profile/provider counts and file paths.

- [x] **Step 5: Verify overlay and service behavior**

Run from `packages/desktop`:

```bash
bun test ./src/main/model-center/runtime-config.test.ts ./src/main/model-center/service.test.ts ./src/main/model-center/e2e-secrets.test.ts
bun typecheck
```

Expected: all tests pass; the secrets test finds no API key in generated config, logs, or manifests.

- [x] **Step 6: Commit the authoritative overlay**

```bash
git add packages/desktop/src/main/model-center/runtime-config.ts packages/desktop/src/main/model-center/runtime-config.test.ts packages/desktop/src/main/model-center/service.test.ts packages/desktop/src/main/index.ts
git commit -m "fix(desktop): derive providers from model profiles"
```

### Task 3: Remove Competing Renderer Config Writes

**Files:**
- Modify: `packages/app/src/product/model-center/controller.ts`
- Modify: `packages/app/src/product/model-center/controller.test.ts`
- Modify: `packages/app/src/components/settings-v2/model-center.tsx`

- [x] **Step 1: Rewrite controller tests around one authority**

Change the fake dependencies so the controller receives only `modelCenter` and `refreshRuntime`. Assert:

```ts
expect(calls).toEqual([
  ["save", input],
  ["reloadCredentials"],
  ["refreshRuntime"],
])
```

Add equivalent exact-order assertions for remove and default selection. Assert a host failure skips refresh, while a refresh failure returns a normalized actionable error without attempting a renderer config rollback.

Default selection is the exception to the explicit reload call: the desktop host already performs the generated-config write, sidecar restart, and rollback as one transaction inside `selectDefault`. Its exact order is `selectDefault`, then `refreshRuntime`, with no second `reloadCredentials` call.

- [x] **Step 2: Run the controller test and confirm the old contract fails**

Run: `bun test ./src/product/model-center/controller.test.ts` from `packages/app`.

Expected: FAIL because the controller still requires `disabledProviders`, `currentModel`, and `updateConfig`.

- [x] **Step 3: Simplify the controller**

Use this dependency boundary:

```ts
type ProductModelCenterControllerOptions = {
  readonly modelCenter: ProductModelCenterAPI
  readonly refreshRuntime: () => Promise<unknown>
}
```

`save` and `remove` call their product-host operation, then `modelCenter.reloadCredentials()`, then `refreshRuntime()`. `selectDefault` calls the transactional product-host operation and then `refreshRuntime()`; it must not trigger a second sidecar restart. Remove `enableProviderPatch`, `disableProviderPatch`, `defaultModelPatch`, compensating global config updates, and local observed/configured model tracking from this controller. The desktop host/profile repository is authoritative; the generated overlay performs exact replacement.

- [x] **Step 4: Update the settings integration**

In `model-center.tsx`, remove the `openCodeConfigPatch` bridge and initially adapt the controller's `refreshRuntime` callback to `serverSync().refreshProviders()`. Task 4 replaces that adapter with the complete reconnect reconciliation method. Cloud-provider settings continue to use the existing OpenCode config APIs elsewhere.

- [x] **Step 5: Verify model-center UI and product tests**

Run from `packages/app`:

```bash
bun test ./src/product/model-center ./src/components/settings-v2/model-center-controller.test.ts
bun typecheck
```

Expected: tests pass, including save/remove/default error presentation.

- [x] **Step 6: Commit the controller simplification**

```bash
git add packages/app/src/product/model-center/controller.ts packages/app/src/product/model-center/controller.test.ts packages/app/src/components/settings-v2/model-center.tsx
git commit -m "fix(app): centralize product model configuration"
```

### Task 4: Reconcile Sessions After Every Reconnect

**Files:**
- Modify: `packages/app/src/context/server-sync.tsx`
- Modify: `packages/app/src/context/server-sync.test.ts`

- [x] **Step 1: Add failing status reconciliation tests**

Replace seed-only expectations with a pure reconciliation helper. Starting with renderer statuses `busy`, `retry`, and `idle`, assert:

```ts
reconcileActiveSessionStatuses(session, { running: { type: "running" } })
expect(session.data.session_status.running).toEqual({ type: "busy" })
expect(session.data.session_status.completed).toEqual({ type: "idle" })
expect(session.data.session_status.failed).toEqual({ type: "idle" })
```

Add a reconnect test that invokes the `server.connected` path twice with existing query data and expects both connections to refetch active sessions. Add a visible-session test that expects `session.resolve(id, { force: true })` for renderer sessions that were non-idle before reconciliation.

- [x] **Step 2: Run reconnect tests to prove the stale state**

Run: `bun test ./src/context/server-sync.test.ts` from `packages/app`.

Expected: FAIL because current code seeds missing statuses only and skips active refetch once data exists.

- [x] **Step 3: Implement full reconciliation**

Change `seedActiveSessionStatuses` into `reconcileActiveSessionStatuses`. For each backend active ID, write its current running/retry status. For each renderer status that is non-idle and absent from the backend active map, write `{ type: "idle" }` and return that session ID for forced content resolution.

On every global `server.connected` event:

```ts
void refreshRuntime().catch(() => undefined)
```

Implement `refreshRuntime` as one guarded in-flight request that refetches global config, all provider queries, active sessions, agents for loaded workspaces, and force-resolves visible/non-idle sessions after status reconciliation. Reuse the same method after model-center restart so explicit edits and event reconnects follow one recovery path.

Update `model-center.tsx` from the Task 3 provider-only adapter to `refreshRuntime: () => serverSync().refreshRuntime()` after the method is exposed by the sync context.

- [x] **Step 4: Ensure errors terminate stale running UI**

When active-session reconciliation or forced resolution fails, set any affected renderer-only non-idle session to `{ type: "idle" }` and preserve the existing request/session error payload for display. Do not synthesize a successful assistant message.

- [x] **Step 5: Verify sync behavior and type checking**

Run from `packages/app`:

```bash
bun test ./src/context/server-sync.test.ts ./src/context/server-session.test.ts ./src/context/server-sdk.test.ts
bun typecheck
```

Expected: tests pass; repeated reconnects are coalesced while one refresh is in flight and a later reconnect can run a new refresh.

- [x] **Step 6: Commit reconnect recovery**

```bash
git add packages/app/src/context/server-sync.tsx packages/app/src/context/server-sync.test.ts packages/app/src/components/settings-v2/model-center.tsx
git commit -m "fix(app): reconcile sessions after reconnect"
```

### Task 5: Repair Stale Model Selection

**Files:**
- Create: `packages/app/src/context/model-selection.ts`
- Create: `packages/app/src/context/model-selection.test.ts`
- Create: `packages/app/src/context/model-recent-pruning.ts`
- Create: `packages/app/src/context/model-recent-pruning.test.ts`
- Create: `packages/app/src/context/global-sync/provider-readiness.ts`
- Create: `packages/app/src/context/global-sync/provider-readiness.test.ts`
- Modify: `packages/app/src/context/models.tsx`
- Modify: `packages/app/src/context/local.tsx`
- Modify: `packages/app/src/context/server-sync.tsx`
- Modify: `packages/app/src/context/global-sync/bootstrap.ts`
- Modify: `packages/app/src/context/global-sync/child-store.ts`
- Modify: `packages/app/src/context/global-sync/child-store.test.ts`
- Modify: `packages/app/src/hooks/use-providers.ts`
- Modify: `packages/app/src/hooks/provider-catalog.ts`
- Modify: `packages/app/src/hooks/provider-catalog.test.ts`
- Modify: `packages/app/src/pages/session/composer/prompt-model-selection.ts`
- Modify: `packages/app/src/pages/new-session/new-session-view.tsx`
- Modify: `packages/app/src/product/workflow/use-model-readiness.ts`

- [x] **Step 1: Add stale selection tests**

Construct connected provider data where recent storage and an existing session reference `agent-profile-old/coder`, while global config selects `agent-profile-current/deepseek-v4-pro`. Assert the shared production candidate builder resolves the configured valid default and preserves explicit, agent, config, recent, and fallback precedence. Add a no-model case that resolves `undefined`, plus a configured model ID containing `/` so provider/model parsing remains correct. Add browser-reactive pruning coverage for pending, failed, successful, and refreshed provider catalogs.

- [x] **Step 2: Run the focused tests**

Run from `packages/app`:

```bash
bun test ./src/context/model-selection.test.ts
bun test --conditions=browser --preload ./happydom.ts ./src/context/model-recent-pruning.test.ts
```

Expected: the shared model-selection module and persisted orphan-pruning behavior do not exist yet.

- [x] **Step 3: Prune invalid persisted model references**

Keep the established selection order for valid current-session models, but validate every candidate against the refreshed connected provider map. Share the parsing and production candidate construction between the local/session and new-composer selectors. For a new prompt, prefer the valid generated config default over invalid recent/session references. Mark global and workspace provider catalogs ready only after a successful settled provider query; pending and failed initial requests or refreshes must not prune persisted recents. Repeat pruning after each later successful catalog refresh. Preserve the explicit no-model result when there is no connected model.

- [x] **Step 4: Verify model fallback behavior**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/context/model-selection.test.ts ./src/context/model-variant.test.ts ./src/context/local-agent.test.ts ./src/context/global-sync/provider-readiness.test.ts ./src/context/global-sync/child-store.test.ts ./src/hooks/provider-catalog.test.ts ./src/product/workflow/model-readiness.test.ts ./src/product/workflow/use-model-readiness.test.ts ./src/pages/session/session-model-helpers.test.ts
bun test --conditions=browser --preload ./happydom.ts ./src/context/model-recent-pruning.test.ts
bun typecheck
```

Expected: all tests pass and invalid provider IDs do not become the selected model.

- [x] **Step 5: Commit model selection recovery**

```bash
git add docs/superpowers/plans/2026-08-15-runtime-isolation-recovery.md packages/app/src/context/model-selection.ts packages/app/src/context/model-selection.test.ts packages/app/src/context/model-recent-pruning.ts packages/app/src/context/models.tsx packages/app/src/context/local.tsx packages/app/src/hooks/use-providers.ts packages/app/src/pages/session/composer/prompt-model-selection.ts
git commit -m "fix(app): recover stale model selections"
```

- [x] **Step 6: Correct provider readiness after spec review**

Require successful, settled provider queries for both global and workspace readiness. Exercise the production pruning effect through pending, failed, successful, and refreshed states; audit existing readiness consumers; and commit the corrections without touching protected untracked files.

```bash
git add docs/superpowers/plans/2026-08-15-runtime-isolation-recovery.md packages/app/src/context/global-sync/bootstrap.ts packages/app/src/context/global-sync/child-store.ts packages/app/src/context/global-sync/child-store.test.ts packages/app/src/context/global-sync/provider-readiness.ts packages/app/src/context/global-sync/provider-readiness.test.ts packages/app/src/context/server-sync.tsx packages/app/src/context/model-selection.ts packages/app/src/context/model-selection.test.ts packages/app/src/context/model-recent-pruning.ts packages/app/src/context/model-recent-pruning.test.ts packages/app/src/context/models.tsx packages/app/src/context/local.tsx packages/app/src/hooks/provider-catalog.ts packages/app/src/hooks/provider-catalog.test.ts packages/app/src/hooks/use-providers.ts packages/app/src/pages/new-session/new-session-view.tsx packages/app/src/pages/session/composer/prompt-model-selection.ts packages/app/src/product/workflow/use-model-readiness.ts
git commit -m "fix(app): require successful provider catalogs"
```

### Task 6: Stamp an Identifiable Alpha 3 Build

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/electron.vite.config.ts`
- Modify: `packages/desktop/src/main/env.d.ts`
- Modify: `packages/app/src/context/platform.tsx`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `.github/workflows/windows-internal-beta.yml`
- Modify: `packages/desktop/scripts/package-internal-mac.ts`
- Modify: `packages/desktop/scripts/package-internal-mac.test.ts`
- Modify: `packages/desktop/scripts/package-internal-windows.test.ts`
- Modify: `packages/desktop/scripts/windows-internal-beta-ci.test.ts`

- [ ] **Step 1: Add build identity assertions**

Update package tests to expect `0.1.0-alpha.3`. Add assertions that the Mac isolated build receives `GUAI_CODE_BUILD_COMMIT` equal to its captured clean source commit and that the Windows workflow maps `GUAI_CODE_BUILD_COMMIT` from `GITHUB_SHA` before `bun run package:win:internal`.

- [ ] **Step 2: Run build metadata tests and confirm failure**

Run from `packages/desktop`:

```bash
bun test ./scripts/package-internal-mac.test.ts ./scripts/package-internal-windows.test.ts ./scripts/windows-internal-beta-ci.test.ts
```

Expected: FAIL on version and missing build-revision environment assertions.

- [ ] **Step 3: Bump and compile the revision**

Set the desktop package version and workflow guard to `0.1.0-alpha.3`. In `electron.vite.config.ts`, add this renderer define:

```ts
"import.meta.env.GUAI_CODE_BUILD_COMMIT": JSON.stringify(process.env.GUAI_CODE_BUILD_COMMIT ?? "")
```

Type it in `env.d.ts`, add optional `buildRevision?: string` to `PlatformBase`, and populate it in the desktop renderer. Display only the first seven characters:

```tsx
<span>
  v{platform.version}
  {platform.buildRevision ? ` (${platform.buildRevision.slice(0, 7)})` : ""}
</span>
```

- [ ] **Step 4: Pass one source revision through both builders**

In the isolated Mac packaging environment, assign `GUAI_CODE_BUILD_COMMIT` from the already captured `sourceBeforeBuild.commit`. In the Windows workflow, set the environment variable from `GITHUB_SHA` for the build and package steps. Keep `BUILD-INFO.json` source commit validation unchanged.

- [ ] **Step 5: Verify build identity tests and both package typechecks**

Run:

```bash
cd packages/desktop && bun test ./scripts/package-internal-mac.test.ts ./scripts/package-internal-windows.test.ts ./scripts/windows-internal-beta-ci.test.ts && bun typecheck
cd ../app && bun typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit build identity**

```bash
git add packages/desktop/package.json packages/desktop/electron.vite.config.ts packages/desktop/src/main/env.d.ts packages/desktop/src/renderer/index.tsx packages/app/src/context/platform.tsx packages/app/src/components/settings-v2/dialog-settings-v2.tsx .github/workflows/windows-internal-beta.yml packages/desktop/scripts/package-internal-mac.ts packages/desktop/scripts/package-internal-mac.test.ts packages/desktop/scripts/package-internal-windows.test.ts packages/desktop/scripts/windows-internal-beta-ci.test.ts
git commit -m "chore(desktop): identify alpha 3 packages"
```

### Task 7: Regression and Package Verification

**Files:**
- Modify only if a focused regression reveals a defect in files already listed above.
- Verify: generated Mac and Windows internal artifacts.

- [ ] **Step 1: Run focused desktop and app regression suites**

Run:

```bash
cd packages/desktop && bun test ./src/main ./scripts/package-internal-mac.test.ts ./scripts/package-internal-windows.test.ts ./scripts/windows-internal-beta-ci.test.ts
cd ../app && bun run test:unit
```

Expected: all tests pass. Do not run the hour-long soak suite.

- [ ] **Step 2: Verify no helper process survives cancellation**

Run each fast package/mock-server test under a short parent command, then inspect only descendants of that command. Expected: no `mock-openai-server.fixture.test.ts`, packaging fixture, or `SessionRunCoordinator` test process remains after the test exits. Do not kill unrelated Bun, Electron, Codex, or Guai Code processes.

- [ ] **Step 3: Build the Mac internal package from the clean revision**

Run from `packages/desktop`:

```bash
bun run package:mac:internal
```

Expected: an internal `0.1.0-alpha.3` ZIP/DMG whose `BUILD-INFO.json` commit matches `git rev-parse HEAD`, and whose settings footer shows the same seven-character revision.

- [ ] **Step 4: Perform short Mac package smoke checks**

Use an isolated test user-data directory and verify:

- no shared `~/.config/opencode` or `~/.local/share/opencode` provider appears;
- existing product profile metadata is regenerated into the isolated overlay;
- save, default selection, immediate prompt, and sidecar restart work without reopening;
- a completed response does not remain busy after reconnect;
- application logs and generated runtime files contain no plaintext credentials.

Expected: every check passes. Record long-duration slowdown testing as a separate human test.

- [ ] **Step 5: Push the exact source revision and run Windows internal packaging**

Push the current branch, dispatch `.github/workflows/windows-internal-beta.yml` for that revision, and wait for the workflow. Expected: Windows artifacts report version `0.1.0-alpha.3`, `sourceCommit` equals the Mac package commit, and all workflow verification steps pass.

- [ ] **Step 6: Commit any verification-only fixes, then record artifact identities**

If focused verification required code changes, rerun the affected focused test and commit with a concrete conventional message such as `fix(desktop): preserve isolated runtime paths` or `fix(app): clear stale reconnect state`. Record final Mac and Windows artifact paths, SHA-256 values, version, source commit, and test results in the delivery summary; do not commit generated installers.

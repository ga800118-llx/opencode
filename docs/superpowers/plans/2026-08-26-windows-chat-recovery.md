# Windows Chat Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make packaged Windows installations recover empty and cached conversations reliably, ship file-search tooling instead of downloading it at runtime, and expose enough lifecycle logging to diagnose a provider turn that never returns.

**Architecture:** Clamp message history query sizes at the app's network boundary and absorb failures from delayed background refreshes. Extend the existing internal Windows packaging pipeline with a pinned official `ripgrep` resource and prepend it to the sidecar `PATH`. Add metadata-only logs at durable prompt admission and around the single provider stream call without changing timeout, retry, model, or UI behavior.

**Tech Stack:** TypeScript, Bun tests, SolidJS stores, Effect, Electron, electron-builder, PowerShell, Windows x64.

---

## File Map

- Modify `packages/app/src/context/server-session.ts`: normalize outbound history page sizes to the protocol range.
- Modify `packages/app/src/context/server-session.test.ts`: cover zero and oversized history requests.
- Modify `packages/app/src/pages/session/timeline/model.ts`: prevent delayed stale refresh failures from becoming unhandled rejections.
- Create `packages/desktop/src/product/bundled-ripgrep.ts`: resolve and prepend packaged Windows `rg.exe`.
- Create `packages/desktop/src/product/bundled-ripgrep.test.ts`: cover platform, package, executable, and `PATH` behavior.
- Modify `packages/desktop/src/main/index.ts`: enable packaged ripgrep before the sidecar starts.
- Modify `packages/desktop/electron-builder.config.ts`: copy staged ripgrep into packaged resources.
- Modify `packages/desktop/electron-builder.config.test.ts`: cover the new resource mapping.
- Modify `packages/desktop/scripts/package-internal-windows.ts`: pin, download, verify, extract, stage, and validate ripgrep.
- Modify `packages/desktop/scripts/package-internal-windows.test.ts`: cover archive metadata and required portable entries.
- Modify `packages/desktop/scripts/verify-internal-windows.ps1`: require the ripgrep executable and license during package verification.
- Modify `packages/desktop/scripts/windows-internal-evidence.ts`: accept the expanded portable required-entry contract.
- Modify `packages/server/src/handlers/session.ts`: log successful durable prompt admission.
- Modify `packages/core/src/session/runner/llm.ts`: log provider-turn start, first event, completion, interruption, and failure.

### Task 1: Repair Empty Session Refresh

- [ ] **Step 1: Change the V1 regression test to require a valid lower bound**

In `packages/app/src/context/server-session.test.ts`, replace the explicit-zero expectation with:

```ts
test("normalizes an explicit zero message limit on V1", async () => {
  const client = messageClient(response())
  const store = createServerSession(client, { protocol: Promise.resolve("v1") })
  store.remember(session("child"))

  await store.sync("child", { force: true, messageLimit: 0 })

  expect(client.requests).toEqual([{ sessionID: "child", limit: 1, before: undefined }])
})
```

Add a V2 case that requests `201` and expects `200` in the `messageApi.list` input.

- [ ] **Step 2: Run the focused test and verify the lower-bound case fails**

Run from `packages/app`:

```bash
bun test src/context/server-session.test.ts
```

Expected: the zero-limit test fails because the client still receives `limit: 0`.

- [ ] **Step 3: Normalize only the outbound request**

In `packages/app/src/context/server-session.ts`, add next to the page-size constants:

```ts
const normalizeMessagePageSize = (value: number) =>
  Math.max(1, Math.min(historyMessagePageSize, Number.isFinite(value) ? Math.trunc(value) : initialMessagePageSize))
```

At the beginning of `fetchMessages`, compute `const pageSize = normalizeMessagePageSize(limit)` and pass `pageSize` to both `messageApi.list(...)` and `client.session.messages(...)`. Keep `meta.limit` unchanged so an empty local session still records zero visible messages.

- [ ] **Step 4: Absorb delayed stale-refresh failures**

In `packages/app/src/pages/session/timeline/model.ts`, change the background call to:

```ts
if (stale) void sync().session.sync(id, { force: true }).catch(() => {})
```

The foreground resource continues returning `sync().session.sync(id)` so visible initial-load failures remain observable.

- [ ] **Step 5: Run focused app tests and typecheck**

Run from `packages/app`:

```bash
bun test src/context/server-session.test.ts src/pages/session/timeline/model.test.ts
bun typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit the session recovery fix**

```bash
git add packages/app/src/context/server-session.ts packages/app/src/context/server-session.test.ts packages/app/src/pages/session/timeline/model.ts
git commit -m "fix(app): recover empty session refresh"
```

### Task 2: Bundle Windows Ripgrep

- [ ] **Step 1: Add failing product-helper tests**

Create `packages/desktop/src/product/bundled-ripgrep.test.ts` with cases equivalent to the bundled Git helper:

```ts
import { describe, expect, test } from "bun:test"
import { win32 } from "node:path"
import { createBundledRipgrepEnvironment } from "./bundled-ripgrep"

describe("bundled ripgrep environment", () => {
  const resourcesPath = String.raw`C:\Program Files\Guai Code\resources`
  const directory = win32.join(resourcesPath, "ripgrep")
  const executable = win32.join(directory, "rg.exe")

  test("prepends packaged ripgrep on Windows", () => {
    expect(createBundledRipgrepEnvironment({
      platform: "win32",
      packaged: true,
      resourcesPath,
      inheritedPath: String.raw`C:\Windows\System32`,
      exists: (path) => path === executable,
    })).toEqual({ directory, path: `${directory};C:\\Windows\\System32` })
  })

  test("leaves development, non-Windows, and missing binaries unchanged", () => {
    expect(createBundledRipgrepEnvironment({ platform: "win32", packaged: false, resourcesPath, inheritedPath: "", exists: () => true })).toBeUndefined()
    expect(createBundledRipgrepEnvironment({ platform: "darwin", packaged: true, resourcesPath, inheritedPath: "", exists: () => true })).toBeUndefined()
    expect(createBundledRipgrepEnvironment({ platform: "win32", packaged: true, resourcesPath, inheritedPath: "", exists: () => false })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run from `packages/desktop`:

```bash
bun test src/product/bundled-ripgrep.test.ts
```

Expected: failure because `bundled-ripgrep.ts` does not exist.

- [ ] **Step 3: Implement the Windows-only environment helper**

Create `packages/desktop/src/product/bundled-ripgrep.ts`:

```ts
import { win32 } from "node:path"

export function createBundledRipgrepEnvironment(input: {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  inheritedPath: string | undefined
  exists: (path: string) => boolean
}) {
  if (!input.packaged || input.platform !== "win32") return
  const directory = win32.join(input.resourcesPath, "ripgrep")
  if (!input.exists(win32.join(directory, "rg.exe"))) return
  return {
    directory,
    path: input.inheritedPath ? `${directory}${win32.delimiter}${input.inheritedPath}` : directory,
  }
}
```

- [ ] **Step 4: Enable the resource before sidecar startup**

In `packages/desktop/src/main/index.ts`, import the helper, call it after bundled Git setup using the current `process.env.PATH`, assign the returned `path`, and log only the resolved resource directory:

```ts
const bundledRipgrep = createBundledRipgrepEnvironment({
  platform: process.platform,
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  inheritedPath: process.env.PATH,
  exists: existsSync,
})
if (bundledRipgrep) {
  process.env.PATH = bundledRipgrep.path
  log.info("bundled ripgrep enabled", { directory: bundledRipgrep.directory })
}
```

- [ ] **Step 5: Add builder resource mapping and tests**

In `packages/desktop/electron-builder.config.ts`, read `GUAI_CODE_BUNDLED_RIPGREP_DIR?.trim()` and conditionally append:

```ts
{
  from: bundledRipgrepDir,
  to: "ripgrep",
  filter: ["**/*"],
}
```

In `packages/desktop/electron-builder.config.test.ts`, add nonempty and whitespace-only environment tests matching the MinGit resource tests.

- [ ] **Step 6: Pin and verify the official archive**

In `packages/desktop/scripts/package-internal-windows.ts`, add:

```ts
export const RIPGREP_RELEASE = "15.1.0"
export const RIPGREP_ASSET = "ripgrep-15.1.0-x86_64-pc-windows-msvc.zip"
export const RIPGREP_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_RELEASE}/${RIPGREP_ASSET}`
export const RIPGREP_SHA256 = "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a"
export const RIPGREP_SIZE_BYTES = 1_810_687
```

Reuse the bounded download helper with a `label` input so MinGit logs remain `[MinGit]` and ripgrep logs use `[ripgrep]`. Verify size and SHA-256 before extraction. Extract the archive with PowerShell, copy `rg.exe` and `LICENSE-MIT` from its single top-level directory into `dist/internal-resources/ripgrep`, and set `GUAI_CODE_BUNDLED_RIPGREP_DIR` before electron-builder runs.

- [ ] **Step 7: Require the resource in packaged output**

Append these exact entries to `PORTABLE_ZIP_REQUIRED_ENTRIES` and the equivalent `$requiredPortableEntries` array in `packages/desktop/scripts/verify-internal-windows.ps1`:

```text
resources/ripgrep/rg.exe
resources/ripgrep/LICENSE-MIT
```

Update the exact expected required-entry list in `packages/desktop/scripts/windows-internal-evidence.ts` so verifier evidence accepts the new package contract.

- [ ] **Step 8: Add package-script tests**

In `packages/desktop/scripts/package-internal-windows.test.ts`, assert the release, asset URL, byte size, SHA-256, metadata rejection, download command, staging path, and both portable ZIP entries. Keep MinGit assertions unchanged.

- [ ] **Step 9: Run desktop tests and typecheck**

Run from `packages/desktop`:

```bash
bun test src/product/bundled-ripgrep.test.ts electron-builder.config.test.ts scripts/package-internal-windows.test.ts scripts/windows-internal-evidence.test.ts
bun typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 10: Commit bundled ripgrep**

```bash
git add packages/desktop/src/product/bundled-ripgrep.ts packages/desktop/src/product/bundled-ripgrep.test.ts packages/desktop/src/main/index.ts packages/desktop/electron-builder.config.ts packages/desktop/electron-builder.config.test.ts packages/desktop/scripts/package-internal-windows.ts packages/desktop/scripts/package-internal-windows.test.ts packages/desktop/scripts/verify-internal-windows.ps1 packages/desktop/scripts/windows-internal-evidence.ts
git commit -m "fix(desktop): bundle Windows ripgrep"
```

### Task 3: Add Provider Lifecycle Diagnostics

- [ ] **Step 1: Log durable prompt admission**

In `packages/server/src/handlers/session.ts`, bind the prompt result before returning it and emit:

```ts
yield* Effect.logInfo("session prompt admitted", {
  sessionID: admitted.sessionID,
  messageID: admitted.id,
  delivery: admitted.delivery,
})
```

Return `{ data: admitted }`. Do not log `admitted.prompt`.

- [ ] **Step 2: Observe the existing single provider stream**

In `packages/core/src/session/runner/llm.ts`, immediately before `llm.stream(request)` record `Date.now()` and log:

```ts
yield* Effect.logInfo("provider turn started", {
  sessionID,
  step,
  providerID: model.provider,
  modelID: model.id,
  toolCount: request.tools.length,
})
```

Inside the existing event tap, increment an event counter. On the first event, record and log `elapsedMs`. After `claimedStream` resolves, log exactly one terminal entry with `elapsedMs`, `eventCount`, optional `firstEventMs`, and outcome `completed`, `interrupted`, or `failed`. Preserve the existing `Exit`, `Option`, retry, interruption, and stream-return behavior.

- [ ] **Step 3: Verify log data excludes sensitive content**

Use `rg` to inspect the new log objects and confirm they contain only IDs, provider/model names, counts, durations, delivery mode, and outcome:

```bash
rg -n -A12 'session prompt admitted|provider turn (started|first event|finished)' packages/server/src/handlers/session.ts packages/core/src/session/runner/llm.ts
```

Expected: no prompt text, model output, API key, header, or request body is passed to logs.

- [ ] **Step 4: Run server and core verification**

Run:

```bash
cd packages/server && bun typecheck
cd ../core && bun test test/session-runner.test.ts test/session-runner-tool-registry.test.ts && bun typecheck
```

Expected: the runner suites and both package typechecks pass without changing provider-turn behavior.

- [ ] **Step 5: Commit lifecycle logs**

```bash
git add packages/server/src/handlers/session.ts packages/core/src/session/runner/llm.ts
git commit -m "fix(core): log provider turn lifecycle"
```

### Task 4: Build and Inspect the Windows Package

- [ ] **Step 1: Run all focused tests together**

```bash
cd packages/app && bun test src/context/server-session.test.ts src/pages/session/timeline/model.test.ts && bun typecheck
cd ../desktop && bun test src/product/bundled-ripgrep.test.ts electron-builder.config.test.ts scripts/package-internal-windows.test.ts scripts/windows-internal-evidence.test.ts && bun typecheck
cd ../server && bun typecheck
cd ../core && bun test test/session-runner.test.ts test/session-runner-tool-registry.test.ts && bun typecheck
```

Expected: every command passes.

- [ ] **Step 2: Synchronize the committed branch to the prepared Windows builder**

Push the current branch, then on `192.168.200.227` fetch and check out that exact commit. Confirm `git rev-parse HEAD` matches the local commit before packaging.

- [ ] **Step 3: Build the internal Windows artifact**

Run from `packages/desktop` on Windows:

```powershell
bun run package:win:internal
```

Expected: the pinned MinGit and ripgrep resources pass size and SHA-256 checks, electron-builder completes, and installer plus portable ZIP are written under `dist/internal-beta/0.1.0-alpha.8/windows-x64`.

- [ ] **Step 4: Inspect packaged ripgrep and hashes**

Confirm the unpacked and portable packages contain:

```text
resources/ripgrep/rg.exe
resources/ripgrep/LICENSE-MIT
```

Run packaged `rg.exe --version` and expect `ripgrep 15.1.0`. Record installer and portable ZIP SHA-256 values from `SHA256SUMS.txt`.

- [ ] **Step 5: Deliver the installer for manual Windows testing**

Copy the installer, portable ZIP, checksum manifest, and test guide back to the Mac delivery directory. Report that automated focused tests passed and that long-duration real-model testing remains for the user's test machine.

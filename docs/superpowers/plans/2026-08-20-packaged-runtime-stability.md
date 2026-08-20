# Packaged Runtime Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clean and upgraded packaged desktop builds use only configured models, avoid hidden startup work, and become responsive before the main window is restored.

**Architecture:** Keep Electron as the desktop host and OpenCode as the local sidecar. Tighten their boundary with an exact generated provider allowlist, a desktop-only runtime flag, an authenticated readiness probe, and in-memory secure credential caching. Preserve user data and repair invalid selections through live-model validation rather than destructive migration.

**Tech Stack:** TypeScript, Bun, Electron, SolidJS, Effect, electron-store

---

### Task 1: Make product models authoritative

**Files:**
- Modify: `packages/desktop/src/main/model-center/runtime-config.ts`
- Test: `packages/desktop/src/main/model-center/runtime-config.test.ts`

- [x] Add a failing assertion for an exact `enabled_providers` list.
- [x] Include all presented product provider IDs in stable profile order.
- [x] Verify that zero profiles produces `enabled_providers: []` and no fallback model.

### Task 2: Disable implicit desktop dependency installation

**Files:**
- Modify: `packages/core/src/flag/flag.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/desktop/src/main/runtime-environment.ts`
- Test: `packages/desktop/src/main/runtime-environment.test.ts`
- Test: `packages/opencode/test/config/config.test.ts`

- [x] Define an access-time flag for config dependency installation.
- [x] Set the flag only in the isolated desktop sidecar environment.
- [x] Skip the detached npm install while preserving normal CLI behavior.
- [x] Verify desktop environment isolation and config loading.

### Task 3: Cache secure credentials safely

**Files:**
- Modify: `packages/desktop/src/main/model-center/credentials.ts`
- Test: `packages/desktop/src/main/model-center/credentials.test.ts`

- [x] Cache the first secure-storage capability result.
- [x] Cache successfully decrypted immutable envelopes per reference.
- [x] Refresh or invalidate cache entries on write, empty write, and delete.
- [x] Verify repeated capability and credential reads do not call `safeStorage` again.

### Task 4: Repair stale model state without deleting user data

**Files:**
- Modify: `packages/app/src/context/local.tsx`
- Modify: `packages/app/src/context/models.tsx`
- Test: `packages/app/src/context/model-selection.test.ts`
- Test: relevant context persistence tests

- [x] Confirm persisted selections are filtered through the live model catalog.
- [x] Prune unavailable recent model records after providers become ready; stale visibility records are inert.
- [x] Fall back to the generated product default or first configured model.
- [x] Preserve sessions, projects, profiles, and credentials.

### Task 5: Separate liveness from readiness

**Files:**
- Modify: `packages/desktop/src/main/server.ts`
- Modify: `packages/desktop/src/main/sidecar-supervisor.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/src/main/server.test.ts`
- Test: `packages/desktop/src/main/sidecar-supervisor.test.ts`

- [x] Add an authenticated provider-readiness request with a bounded per-request timeout.
- [x] Require readiness after health and before publishing the sidecar as ready.
- [x] Keep supervisor retries and shutdown interruption working.
- [x] Log readiness separately for package diagnostics.

### Task 6: Prevent direct DMG execution

**Files:**
- Add: `packages/desktop/src/main/install-location.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/src/main/install-location.test.ts`

- [x] Detect packaged macOS execution from `/Volumes`.
- [x] Display a concise install instruction and quit before sidecar startup.
- [x] Do not affect development, Windows, Linux, or installed macOS paths.

### Task 7: Short packaged regression

**Files:**
- Modify: `packages/desktop/scripts/package-internal-mac.ts`
- Test: `packages/desktop/scripts/package-internal-mac.test.ts`

- [x] Require provider-readiness evidence before `loading task finished`.
- [x] Assert the clean runtime config has an empty provider allowlist.
- [x] Assert startup did not create runtime config `node_modules`.
- [x] Run focused tests and package-level type checks.
- [x] Build and run one short clean-profile packaged smoke test; leave long-duration use testing to the user.

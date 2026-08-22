# Runtime State Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make permission switching, running-turn elapsed time, and post-model-mutation refreshes reflect authoritative runtime state without requiring a second user action.

**Architecture:** Route the missing V2 permission method through the generated SDK, calculate active turn duration from the live clock, and add one coalesced trailing runtime refresh for model mutations. Keep the fixes isolated in the existing compatibility, timeline-model, and server-sync boundaries.

**Tech Stack:** TypeScript, SolidJS, TanStack Query, generated OpenCode SDK, Bun test runner.

---

### Task 1: Restore V2 Permission Switching

**Files:**
- Modify: `packages/app/src/utils/server-compat.ts`
- Modify: `packages/app/src/utils/server-compat.test.ts`
- Modify: `packages/app/src/context/permission.tsx`
- Modify: `packages/app/src/context/permission-mode.test.ts`

- [x] Add a failing compatibility test that switches permission mode against V2 and expects `/api/session/ses_1/permission-mode` with `{ "mode": "auto" }`.
- [x] Route V2 `switchPermissionMode` through `legacy().v2.session.switchPermissionMode` in the compatibility adapter.
- [x] Remove the permission context's runtime method assertion and call the compatible API directly.
- [x] Add a failing state test proving a rejected existing-task switch restores the previous project default and does not answer pending permissions.
- [x] Implement guarded rollback only for the latest failed switch.
- [x] Run `bun test --conditions=solid --preload ./happydom.ts ./src/utils/server-compat.test.ts ./src/context/permission-mode.test.ts` from `packages/app`.

### Task 2: Keep Active Turn Time Moving

**Files:**
- Modify: `packages/app/src/pages/session/timeline/model.ts`
- Modify: `packages/app/src/pages/session/timeline/model.test.ts`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`

- [x] Add failing pure tests for a working turn with an intermediate completed assistant message and for an idle completed turn.
- [x] Add a pure `calculateTurnDuration` function that uses the live clock while working and the latest completion only after idle.
- [x] Replace the inline duration reduction in the timeline component with the tested function.
- [x] Run `bun test --conditions=solid --preload ./happydom.ts ./src/pages/session/timeline/model.test.ts` from `packages/app`.

### Task 3: Guarantee A Post-Mutation Model Refresh

**Files:**
- Modify: `packages/app/src/context/server-sync.tsx`
- Modify: `packages/app/src/context/server-sync.test.ts`
- Modify: `packages/app/src/components/settings-v2/model-center.tsx`

- [x] Add failing controller tests proving `fresh: true` starts one trailing run behind an active refresh and concurrent fresh requests share it.
- [x] Implement a trailing refresh queue that runs after the active request settles, including after an earlier failure.
- [x] Make Model Center runtime refreshes request `fresh: true`.
- [x] Run `bun test --conditions=solid --preload ./happydom.ts ./src/context/server-sync.test.ts` from `packages/app`.

### Task 4: Verify The Combined Repair

**Files:**
- Verify all files modified in Tasks 1-3.
- Update: `docs/product/internal-beta-issues.md`

- [x] Run all focused application tests from Tasks 1-3 together.
- [x] Run `bun typecheck` from `packages/app`.
- [x] Run the focused permission endpoint and persistence tests from `packages/opencode`.
- [x] Run `git diff --check` and inspect the final diff for unrelated changes.
- [x] Mark the recorded permission issue fixed and add the model-refresh and timer issues with their verification status.

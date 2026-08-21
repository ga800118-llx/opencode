# Session Response Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display completed private-model responses without reopening a task, including when completion races with message loading.

**Architecture:** Keep the current `/api/event` routing contract. On a terminal V2 execution event, run a trailing durable-message refresh after any active session or history load, and use at least the standard initial page size for that repair only.

**Tech Stack:** TypeScript, SolidJS application contexts, Bun test runner, Effect-generated HTTP clients.

---

### Task 1: Lock Event Routing Compatibility

**Files:**
- Verify: `packages/app/src/utils/server-protocol.ts`
- Test: `packages/app/src/utils/server-protocol.test.ts`

- [x] Confirm `/api/event` selects the current V2 event client.
- [x] Add a regression test proving `/event` alone does not select a client route that subscribes to `/api/event`.
- [x] Preserve `/global/event` as the compatibility fallback.

### Task 2: Repair An Empty Completed Page

**Files:**
- Modify: `packages/app/src/context/server-session.ts`
- Test: `packages/app/src/context/server-session.test.ts`

- [x] Reproduce completion after an initially empty V2 message page.
- [x] Wait for an active session sync before starting the completion repair.
- [x] Use at least `initialMessagePageSize` for the V2 completion repair instead of reusing a cached zero count.
- [x] Verify the assistant response is projected after the repair.
- [x] Verify a V1 caller-supplied zero limit remains unchanged.

### Task 3: Queue Repair Behind History Loading

**Files:**
- Modify: `packages/app/src/context/server-session.ts`
- Test: `packages/app/src/context/server-session.test.ts`

- [x] Reproduce a terminal V2 event while a direct history page load is active.
- [x] Record a pending repair when the history load owns the message loader.
- [x] Trigger one trailing latest-page refresh when the load finishes.
- [x] Verify the projected timeline contains the completed assistant response.
- [x] Cancel queued and waiting repairs when the session is deleted or evicted.

### Task 4: Verify The Combined Recovery Path

**Files:**
- Verify: `packages/app/src/utils/server-protocol.ts`
- Verify: `packages/app/src/context/server-session.ts`
- Verify: `packages/app/src/utils/server-protocol.test.ts`
- Verify: `packages/app/src/context/server-session.test.ts`

- [x] Run the affected protocol and session tests together.
- [x] Run `bun typecheck` from `packages/app`.
- [x] Run scoped `git diff --check`.
- [x] Restart the development app and verify a real private-model prompt displays without reopening the task.
- [x] Confirm the new runtime log contains no `limit=0` schema rejection for that prompt.

# Stale Session Tab Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove persisted session tab references only when their connected server definitively reports that the session no longer exists.

**Architecture:** Add a small reconciliation controller that deduplicates server/session references and caches only confirmed-present results. Integrate it into the Tabs context after persistence and server synchronization are ready, using the existing compatibility session resolver and existing tab removal action.

**Tech Stack:** TypeScript, SolidJS reactive context, Bun test, OpenCode compatible session API.

---

### Task 1: Reconciliation Controller

**Files:**
- Create: `packages/app/src/context/session-tab-reconciliation.ts`
- Modify: `packages/app/src/context/tabs.test.ts`

- [ ] **Step 1: Write failing controller tests**

Add imports and tests with these cases:

```ts
import { createSessionTabReconciler, probeSessionTab } from "./session-tab-reconciliation"

test("deduplicates session references and removes only confirmed missing sessions", async () => {
  const probes: string[] = []
  const removed: Array<{ server: ServerConnection.Key; sessionIDs: string[] }> = []
  const reconciler = createSessionTabReconciler({
    probe: async (tab) => {
      probes.push(tab.sessionId)
      return tab.sessionId === "missing" ? "missing" : "present"
    },
    remove: (target, sessionIDs) => removed.push({ server: target, sessionIDs }),
  })

  await reconciler.reconcile([sessionTab("present"), sessionTab("missing"), sessionTab("missing")])

  expect(probes).toEqual(["present", "missing"])
  expect(removed).toEqual([{ server, sessionIDs: ["missing"] }])
})

test("retries unavailable probes without repeating settled probes", async () => {
  const attempts = new Map<string, number>()
  const reconciler = createSessionTabReconciler({
    probe: async (tab) => {
      attempts.set(tab.sessionId, (attempts.get(tab.sessionId) ?? 0) + 1)
      return tab.sessionId === "retry" ? "unavailable" : "present"
    },
    remove() {},
  })

  await reconciler.reconcile([sessionTab("present"), sessionTab("retry")])
  await reconciler.reconcile([sessionTab("present"), sessionTab("retry")])

  expect(attempts).toEqual(new Map([["present", 1], ["retry", 2]]))
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bun test --conditions=solid --preload ./happydom.ts src/context/tabs.test.ts
```

Expected: FAIL because `createSessionTabReconciler` does not exist.

- [ ] **Step 3: Implement the controller**

Create a controller with this public contract and implementation shape:

```ts
export type SessionTabProbeResult = "present" | "missing" | "unavailable"

export function createSessionTabReconciler(input: {
  probe: (tab: SessionTab) => Promise<SessionTabProbeResult>
  remove: (server: SessionTab["server"], sessionIDs: string[]) => void
}) {
  return {
    reconcile: (tabs: readonly SessionTab[]) => Promise<void>,
  }
}
```

Use `JSON.stringify([tab.server, tab.sessionId])` as the key. Keep process-local `settled`, `pending`, and `removed` sets/maps. Do not cache `unavailable`; cache `present` and `missing`; group newly confirmed missing IDs by server and pass each group to `remove` once.

- [ ] **Step 4: Run the focused test and verify success**

Run the Task 1 test command. Expected: PASS.

### Task 2: Tabs Context Integration

**Files:**
- Modify: `packages/app/src/context/tabs.tsx`
- Modify: `packages/app/src/context/tabs.test.ts`

- [ ] **Step 1: Add classification tests**

Add these cases:

```ts
test("classifies only explicit session-not-found errors as missing", async () => {
  const typed = new Error("missing", {
    cause: { body: { _tag: "SessionNotFoundError", sessionID: "gone", message: "missing" }, status: 404 },
  })

  expect(await probeSessionTab("gone", async () => Promise.reject(typed))).toBe("missing")
  expect(await probeSessionTab("gone", async () => Promise.reject(new Error("Session not found: gone")))).toBe(
    "missing",
  )
  expect(await probeSessionTab("gone", async () => Promise.reject(new Error("offline")))).toBe("unavailable")
  expect(await probeSessionTab("live", async () => ({ id: "live" }))).toBe("present")
})
```

- [ ] **Step 2: Run tests and verify the new cases fail**

Run the Task 1 test command. Expected: FAIL before integration helpers exist.

- [ ] **Step 3: Integrate reconciliation**

After the `actions` object is created, instantiate the controller:

```ts
const reconciler = createSessionTabReconciler({
  probe: async (tab) => {
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
    if (!conn) return "unavailable"
    const ctx = global.ensureServerCtx(conn)
    if (!ctx.sync.ready) return "unavailable"
    return probeSessionTab(tab.sessionId, () => ctx.sync.session.resolve(tab.sessionId, { force: true }))
  },
  remove: (targetServer, sessionIDs) =>
    actions.removeSessions({ server: targetServer, directory: "", sessionIDs }),
})
```

Add a Solid effect which waits for `ready()` and `closedReady()`, computes the set of server keys whose `ctx.sync.ready` is true, gathers matching session tabs from `store` and `closed`, and calls `void reconciler.reconcile(candidates)`.

- [ ] **Step 4: Run tab tests**

Run the Task 1 test command. Expected: PASS.

### Task 3: Regression Verification

**Files:**
- Verify: `packages/app/src/context/tabs.tsx`
- Verify: `packages/app/src/context/session-tab-reconciliation.ts`
- Verify: `packages/app/src/context/tabs.test.ts`

- [ ] **Step 1: Run related app tests**

```bash
bun test --conditions=solid --preload ./happydom.ts \
  src/context/tabs.test.ts \
  src/components/titlebar-session-events.test.ts \
  src/pages/home-session-archive.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run app typecheck**

```bash
bun typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Check the scoped diff**

```bash
git diff --check -- \
  packages/app/src/context/session-tab-reconciliation.ts \
  packages/app/src/context/tabs.tsx \
  packages/app/src/context/tabs.test.ts
```

Expected: no output.

- [ ] **Step 4: Manual verification**

Restart the current development app after clearing backend sessions. Confirm stale open and recently closed session references disappear only after server synchronization succeeds, while drafts and tabs belonging to unavailable servers remain.

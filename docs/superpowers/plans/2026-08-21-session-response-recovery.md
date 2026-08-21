# Session Response Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore live private-model responses and guarantee completion-time message recovery without reopening a task.

**Architecture:** Prefer the typed current event stream whenever the V2 OpenAPI document exposes either supported current route. Keep the existing completion repair sync, but normalize an empty cached message-page size back to the standard initial page size before issuing the API request.

**Tech Stack:** TypeScript, SolidJS application contexts, Bun test runner, Effect-generated HTTP clients.

---

### Task 1: Detect The Typed Current Event Stream

**Files:**
- Modify: `packages/app/src/utils/server-protocol.ts:14-31,124-152`
- Test: `packages/app/src/utils/server-protocol.test.ts:120-160`

- [ ] **Step 1: Write the failing route-detection test**

Add a test beside the existing event capability tests:

```ts
test("recognizes the typed current event route on V2", async () => {
  const fetcher = mockFetch(() =>
    Promise.resolve(
      json({
        paths: {
          "/event": { get: {} },
          "/global/event": { get: {} },
        },
      }),
    ),
  )

  expect(await detectServerApiCapabilities(server, fetcher, "v2")).toMatchObject({ event: "current" })
})
```

- [ ] **Step 2: Run the focused test and verify the current code fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/utils/server-protocol.test.ts
```

Expected: the new test reports `global` instead of `current`.

- [ ] **Step 3: Recognize both current event route forms**

Add the event operations beside the other protocol constants:

```ts
const currentEventOperations = [
  ["/event", "get"],
  ["/api/event", "get"],
] as const
```

Update V2 event routing:

```ts
event:
  paths && !hasOperations(paths, currentEventOperations) && hasOperations(paths, [["/global/event", "get"]])
    ? "global"
    : "current",
```

- [ ] **Step 4: Run the focused protocol tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/utils/server-protocol.test.ts
```

Expected: all tests in `server-protocol.test.ts` pass.

### Task 2: Recover Messages After An Empty Initial Page

**Files:**
- Modify: `packages/app/src/context/server-session.ts:932-944`
- Test: `packages/app/src/context/server-session.test.ts:315-356,1819-1843`

- [ ] **Step 1: Reproduce the zero-limit completion repair**

Add a V2 session test that returns an empty first page and a completed turn on the repair request:

```ts
test("uses the initial page size when completion repairs an empty cached page", async () => {
  const requests: unknown[] = []
  const pages = [
    { data: [], cursor: { previous: null, next: null } },
    {
      data: [
        {
          id: "assistant",
          type: "assistant" as const,
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [{ type: "text" as const, text: "hi" }],
          time: { created: 2, completed: 3 },
        },
        { id: "user", type: "user" as const, text: "hello", time: { created: 1 } },
      ],
      cursor: { previous: null, next: null },
    },
  ]
  const sessionApi = { get: async () => session("child") } as unknown as SessionApi
  const messageApi = {
    list: async (input: unknown) => {
      requests.push(input)
      return pages.shift()!
    },
  } as unknown as MessageApi
  const store = createServerSession({} as OpencodeClient, sessionApi, messageApi, {
    protocol: Promise.resolve("v2"),
  })
  store.remember(session("child"))
  await store.sync("child")

  store.applyV2({
    id: "evt_execution_succeeded",
    created: 3,
    type: "session.execution.succeeded",
    location: { directory: "/repo" },
    data: { sessionID: "child" },
  } as OpenCodeEvent)
  await Bun.sleep(0)

  expect(requests).toEqual([
    { sessionID: "child", limit: 20, order: "desc" },
    { sessionID: "child", limit: 20, order: "desc" },
  ])
  expect(store.data.session_message.child.at(-1)).toMatchObject({ type: "assistant" })
})
```

- [ ] **Step 2: Run the focused test and verify the repair uses zero**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/context/server-session.test.ts
```

Expected: the new assertion shows the second request uses `limit: 0`.

- [ ] **Step 3: Normalize an empty cached page to the initial page size**

Update `sync` so the fallback is computed before the parallel fetches:

```ts
const messageLimit = options?.messageLimit ?? meta.limit[sessionID] ?? initialMessagePageSize
await Promise.all([
  resolve(sessionID, options),
  cached && !options?.force
    ? Promise.resolve()
    : loadMessages(sessionID, messageLimit > 0 ? messageLimit : initialMessagePageSize),
])
```

- [ ] **Step 4: Run the focused session tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/context/server-session.test.ts
```

Expected: all tests in `server-session.test.ts` pass and no request contains `limit: 0`.

### Task 3: Verify The Combined Recovery Path

**Files:**
- Verify: `packages/app/src/utils/server-protocol.ts`
- Verify: `packages/app/src/context/server-session.ts`
- Verify: `packages/app/src/utils/server-protocol.test.ts`
- Verify: `packages/app/src/context/server-session.test.ts`

- [ ] **Step 1: Run all affected unit tests together**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/utils/server-protocol.test.ts ./src/context/server-sdk.test.ts ./src/context/server-session.test.ts ./src/context/server-sync.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Type-check the application package**

Run from `packages/app`:

```bash
bun typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Restart the development app and test a real private-model prompt**

Restart the existing desktop dev process so the renderer loads the changes. Submit a new prompt in a new task using the configured private model.

Expected: the answer appears without reopening the task, and the current OpenCode log gains no `Expected a value greater than or equal to 1, got 0` rejection for that prompt.

- [ ] **Step 4: Check the scoped diff**

Run from the repository root:

```bash
git diff --check -- packages/app/src/utils/server-protocol.ts packages/app/src/utils/server-protocol.test.ts packages/app/src/context/server-session.ts packages/app/src/context/server-session.test.ts
```

Expected: exit code 0 with no whitespace errors.

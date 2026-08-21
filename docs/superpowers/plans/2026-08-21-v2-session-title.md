# V2 Session Automatic Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace timestamp-based V2 task titles after the first successful answer without delaying conversation output or overwriting manual renames.

**Architecture:** Add a durable, compare-and-set title event projected onto the Session table. A focused title collaborator schedules one bounded background model request with a local first-prompt fallback; the V2 runner invokes it after success. The desktop applies the event only when its cached title matches the event's previous title and refreshes the Home task index.

**Tech Stack:** TypeScript, Effect, Drizzle SQLite, SolidJS, Bun test.

---

### Task 1: Durable Title Event

**Files:**
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/core/src/session/projector.ts`
- Test: `packages/core/test/session-runner.test.ts`

- [ ] **Step 1: Add the durable event definition**

Add `TitleGenerated` beside the other Session metadata events:

```ts
export const TitleGenerated = Event.define({
  type: "session.next.title.generated",
  ...options,
  schema: {
    ...Base,
    previousTitle: Schema.String,
    title: Schema.String,
  },
})
```

- [ ] **Step 2: Add compare-and-set projection**

Register a projector that updates only the matching default title, preserving a concurrent manual rename:

```ts
yield* events.project(SessionEvent.TitleGenerated, (event) =>
  db
    .update(SessionTable)
    .set({ title: event.data.title })
    .where(and(eq(SessionTable.id, event.data.sessionID), eq(SessionTable.title, event.data.previousTitle)))
    .run()
    .pipe(Effect.orDie),
)
```

- [ ] **Step 3: Regenerate public clients**

Run from `packages/client`:

```bash
bun run generate
```

Expected: generated Protocol clients include `session.next.title.generated`; do not edit generated files manually.

### Task 2: Background Title Collaborator

**Files:**
- Create: `packages/core/src/session/title.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Test: `packages/core/test/session-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Add tests that use a timestamp default title and two mock provider streams: the normal answer followed by the title response. Subscribe to `SessionEvent.TitleGenerated` before resuming and assert the stored title changes. Add cases for empty title output falling back to the normalized first prompt and for a non-default title producing no title request.

- [ ] **Step 2: Run focused tests and confirm failure**

Run from `packages/core`:

```bash
bun test test/session-runner.test.ts --test-name-pattern "title"
```

Expected: the new tests fail because V2 does not schedule title generation.

- [ ] **Step 3: Implement the title collaborator**

Create a collaborator that:

```ts
export const make = Effect.gen(function* () {
  const events = yield* EventV2.Service
  const llm = yield* LLMClient.Service
  const agents = yield* AgentV2.Service
  const models = yield* SessionRunnerModel.Service
  const store = yield* SessionStore.Service
  const scope = yield* Scope.Scope
  const active = new Set<SessionSchema.ID>()

  return {
    schedule: Effect.fn("SessionTitle.schedule")(function* (sessionID: SessionSchema.ID) {
      // Validate root/default title and first user input, coalesce by Session ID,
      // then fork a bounded tool-free title request into the Location layer scope.
    }),
  }
})
```

The generated title is the first non-empty line after removing `<think>` blocks and surrounding quotes, limited to 50 Unicode characters. The fallback combines the first prompt text and filenames, collapses whitespace, and applies the same limit. Provider failure or a 20-second timeout logs a warning and uses the fallback. Before publishing, reload the session and require its title to equal the captured `previousTitle`.

- [ ] **Step 4: Schedule after successful execution**

Instantiate the collaborator in `SessionRunnerLLM` and call `titles.schedule(input.sessionID)` after publishing `SessionEvent.Execution.Succeeded`. The schedule method must return immediately after forking, so the title request does not delay assistant completion.

- [ ] **Step 5: Run focused core tests**

Run from `packages/core`:

```bash
bun test test/session-runner.test.ts --test-name-pattern "title"
```

Expected: generated-title, fallback-title, and preserved-title tests pass.

### Task 3: Desktop Title Synchronization

**Files:**
- Modify: `packages/app/src/context/server-session.ts`
- Modify: `packages/app/src/context/global-sync/home-session-index.ts`
- Test: `packages/app/src/context/server-session.test.ts`
- Test: `packages/app/src/context/global-sync/home-session-index.test.ts`

- [ ] **Step 1: Add failing desktop reducer tests**

Verify `session.next.title.generated` replaces a matching default title in the active Session store, does not replace a different title, and marks the Home task index for refresh.

- [ ] **Step 2: Apply the current event to active tabs**

Extend the current-event input type and handle the event before message projection:

```ts
if (event.type === "session.next.title.generated") {
  const info = data.info[sessionID]
  if (!info || info.title !== event.data.previousTitle) return
  remember({
    ...info,
    title: event.data.title,
    time: { ...info.time, updated: event.data.timestamp },
  })
  return
}
```

- [ ] **Step 3: Refresh the Home task index**

Treat `session.next.title.generated` like `session.next.moved` in `homeSessionIndexRefresh`, causing only the active Home query to refetch its durable title.

- [ ] **Step 4: Run focused app tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/context/server-session.test.ts ./src/context/global-sync/home-session-index.test.ts
```

Expected: all selected tests pass.

### Task 4: Verification

**Files:**
- Verify: `packages/schema/src/session-event.ts`
- Verify: `packages/core/src/session/title.ts`
- Verify: `packages/core/src/session/runner/llm.ts`
- Verify: `packages/core/src/session/projector.ts`
- Verify: `packages/app/src/context/server-session.ts`

- [ ] **Step 1: Type-check affected packages**

Run `bun typecheck` separately from `packages/schema`, `packages/core`, `packages/client`, and `packages/app`. Expected: exit code 0 for each command.

- [ ] **Step 2: Check scoped diffs**

Run `git diff --check` for the files listed above and generated client output. Expected: no whitespace errors.

- [ ] **Step 3: Restart and test the desktop app**

Create a new task with a distinct Chinese prompt, send it with Enter, and wait for the first answer. Confirm the tab leaves `New session`, the title survives restart, a manually renamed task is never changed, and the response remains usable while the background title request runs.

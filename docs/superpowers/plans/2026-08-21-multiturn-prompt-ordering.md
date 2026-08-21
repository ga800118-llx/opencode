# Multiturn Prompt Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep streamed replies below the user message that triggered them and prevent duplicate empty Enter submissions from interrupting a new execution.

**Architecture:** Project optimistic user prompts into both normalized message state and the V2 source timeline using the existing `legacyMessageSource` conversion. Treat blank submit attempts as no-ops; explicit stop controls continue to call the product adapter interrupt endpoint.

**Tech Stack:** TypeScript, SolidJS stores, Bun test runner, V2 session events.

---

### Task 1: Project Optimistic Users Into The V2 Timeline

**Files:**
- Modify: `packages/app/src/context/server-session.ts:1470-1520`
- Test: `packages/app/src/context/server-session.test.ts:1140-1210`

- [ ] **Step 1: Add a failing streaming-order test**

Create an existing user turn, add a second optimistic user, then apply a V2 assistant step and text event. Assert that `session_message` keeps the optimistic user before the assistant and that the normalized assistant parent is the optimistic user ID.

- [ ] **Step 2: Add a failing rollback test**

Add an optimistic user and remove it before any confirmation event. Assert that the user is removed from `message`, `part`, and `session_message`.

- [ ] **Step 3: Run the focused test**

Run from `packages/app`:

```bash
bun test --conditions=solid --only-failures --preload ./happydom.ts ./src/context/server-session.test.ts
```

Expected: the new source-order and rollback assertions fail.

- [ ] **Step 4: Project and roll back the optimistic source entry**

In `optimistic.add`, convert `{ info: input.message, parts }` through `legacyMessageSource` and merge it into `data.session_message[input.sessionID]`.

In `optimistic.remove`, remove the matching source entry only when `item.confirmedMessage` is false. Preserve confirmed source entries exactly as confirmed normalized messages are preserved today.

- [ ] **Step 5: Run the focused session tests**

Expected: all `server-session.test.ts` tests pass.

### Task 2: Make Blank Submissions Harmless

**Files:**
- Modify: `packages/app/src/components/prompt-input/submit.ts:296-318`
- Test: `packages/app/src/components/prompt-input/submit.test.ts:380-440`

- [ ] **Step 1: Add a failing duplicate-submit test**

Set the prompt to an empty text part and `working: () => true`. Call `handleSubmit` and assert that `interruptInputs` remains empty.

- [ ] **Step 2: Run the focused submit test**

Run from `packages/app`:

```bash
bun test --conditions=solid --only-failures --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts
```

Expected: the new test fails because `handleSubmit` calls `abort()`.

- [ ] **Step 3: Remove implicit stop from the blank-submit branch**

Change the blank branch to return without checking `input.working()`. Do not change `abort`, the stop button, `Escape`, or `Ctrl+G` handling.

- [ ] **Step 4: Run the focused submit tests**

Expected: all `submit.test.ts` tests pass.

### Task 3: Verify Multiturn Stability

**Files:**
- Verify: `packages/app/src/context/server-session.ts`
- Verify: `packages/app/src/components/prompt-input/submit.ts`
- Verify: their focused tests

- [ ] **Step 1: Run combined affected tests**

```bash
bun test --conditions=solid --only-failures --preload ./happydom.ts ./src/context/server-session.test.ts ./src/components/prompt-input/submit.test.ts ./src/pages/session/timeline/rows-current.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Type-check the application**

```bash
bun typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Check the scoped diff**

```bash
git diff --check -- packages/app/src/context/server-session.ts packages/app/src/context/server-session.test.ts packages/app/src/components/prompt-input/submit.ts packages/app/src/components/prompt-input/submit.test.ts
```

Expected: no whitespace errors.

- [ ] **Step 4: Test three real turns**

Restart the development app, create a new task, and send three short prompts with Enter. During each stream, verify the user row is already above the assistant row. Confirm all three executions produce assistant messages and no `session.execution.interrupted` event occurs without an explicit stop action.

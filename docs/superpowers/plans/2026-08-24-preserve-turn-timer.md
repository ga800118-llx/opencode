# Preserve Turn Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the original live timer and completed process disclosure unchanged while showing the new ephemeral assistant status as a separate final timeline row.

**Architecture:** Restore the original `Thinking` row as the owner of the pre-response timer and reasoning heading. Keep `AssistantProcess` as the owner of elapsed time and collapsible process history, and narrow `AssistantActivity` to the transient processing/tool label appended after every other active-turn row.

**Tech Stack:** TypeScript, SolidJS, Effect tagged rows, Bun test runner.

---

### Task 1: Separate Timer And Activity Rows

**Files:**
- Modify: `packages/app/src/pages/session/timeline/timeline-row.ts`
- Modify: `packages/app/src/pages/session/timeline/rows.ts`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`
- Test: `packages/app/src/pages/session/timeline/rows-current.test.ts`

- [ ] **Step 1: Write failing projection tests**

Add a busy turn without assistant parts and require the original timer row followed by the new activity row:

```ts
expect(result.rows.map(TimelineRow.key)).toEqual([
  "user-message:msg_user",
  "thinking:msg_user",
  "assistant-activity:msg_user",
])
```

Keep the existing streaming-answer and running-tool assertions so the activity row remains last and only one copy is projected.

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/rows-current.test.ts
```

Expected: the new assertion fails because the busy empty turn currently projects only `AssistantActivity`.

- [ ] **Step 3: Restore the independent timer row type**

Add `Thinking` back to `TimelineRow`, `TimelineRowMap`, and the stable key switch. Remove `reasoningHeading` from `AssistantActivity` so the status row cannot take ownership of timer/reasoning presentation.

```ts
export class Thinking extends Data.TaggedClass("Thinking")<{
  userMessageID: string
  reasoningHeading?: string
}>() {}

export class AssistantActivity extends Data.TaggedClass("AssistantActivity")<{
  userMessageID: string
  tool?: string
}>() {}
```

- [ ] **Step 4: Project the original timer before the status row**

Restore the original busy/no-items condition and append the independent activity row afterward:

```ts
if (isActive && status === "busy" && !error && assistantItems.length === 0) {
  rows.push(new TimelineRow.Thinking({ userMessageID: userMessage.id, reasoningHeading: heading }))
}

if (isActive && status === "busy" && !error) {
  rows.push(new TimelineRow.AssistantActivity({ userMessageID: userMessage.id, tool }))
}
```

- [ ] **Step 5: Restore timer rendering and keep status rendering isolated**

Render `Thinking` with `processLabel(userMessageID)` and its existing reasoning heading. Render `AssistantActivity` only with `assistantActivityLabel(tool)`, preserving its shimmer/fade and immediate removal behavior.

- [ ] **Step 6: Run focused and package-level verification**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/rows-current.test.ts src/pages/session/timeline/model.test.ts
bun typecheck
bun run build
```

Expected: all tests pass, typecheck succeeds, and the production renderer build contains both the `Thinking` timer path and the independent `AssistantActivity` path.

- [ ] **Step 7: Commit the fix**

```bash
git add packages/app/src/pages/session/timeline/timeline-row.ts \
  packages/app/src/pages/session/timeline/rows.ts \
  packages/app/src/pages/session/timeline/message-timeline.tsx \
  packages/app/src/pages/session/timeline/rows-current.test.ts
git commit -m "fix(app): preserve timer with live status"
```

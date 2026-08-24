# Persistent Turn Elapsed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one persistent `Elapsed <duration>` process row above every assistant answer and one independent live status row below only the active answer.

**Architecture:** Project `AssistantProcess` for every turn and remove the temporary `Thinking` row. Render an interactive process trigger only when details exist, while retaining the same elapsed label and divider for text-only turns. Keep `AssistantActivity` last and derive its tool label only from pending or running tool parts.

**Tech Stack:** TypeScript, SolidJS, Effect tagged rows, CSS, Bun test runner.

---

### Task 1: Lock The Timeline Ordering

**Files:**
- Test: `packages/app/src/pages/session/timeline/rows-current.test.ts`

- [ ] **Step 1: Change the text-only assertion to require a persistent process row**

```ts
expect(result.rows.map(TimelineRow.key)).toEqual([
  "user-message:msg_user",
  "assistant-process:msg_user",
  "assistant-part:msg_user:msg_assistant:text:0",
])
expect(result.rows[1]).toMatchObject({ _tag: "AssistantProcess", items: [] })
```

- [ ] **Step 2: Require the process row for busy empty and streaming turns**

```ts
expect(result.rows.map(TimelineRow.key)).toEqual([
  "user-message:msg_user",
  "assistant-process:msg_user",
  "assistant-activity:msg_user",
])
```

For a streaming answer, require the order `UserMessage`, `AssistantProcess`, `AssistantPart`, `AssistantActivity`.

- [ ] **Step 3: Add a completed-tool assertion**

Construct a busy turn with one completed tool and require the last row to match:

```ts
expect(result.rows.at(-1)).toMatchObject({ _tag: "AssistantActivity", tool: undefined })
```

Keep the existing running-tool-plus-later-text test, which requires the live row to retain the most recent running tool.

- [ ] **Step 4: Run the focused test and verify the new expectations fail**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/rows-current.test.ts
```

Expected: text-only, empty busy, streaming, and historical turn assertions fail because the current projection omits `AssistantProcess` and inserts `Thinking` in some states.

### Task 2: Make The Elapsed Row Persistent

**Files:**
- Modify: `packages/app/src/pages/session/timeline/timeline-row.ts`
- Modify: `packages/app/src/pages/session/timeline/rows.ts`

- [ ] **Step 1: Remove the temporary `Thinking` row type**

Delete `Thinking` from the tagged row classes, union, key switch, and `TimelineRowMap`.

- [ ] **Step 2: Project `AssistantProcess` unconditionally after the user message and turn divider**

```ts
rows.push(
  new TimelineRow.AssistantProcess({
    userMessageID: userMessage.id,
    items: processItems,
  }),
)
```

Remove the busy/no-items block that creates `Thinking`. Keep `AssistantActivity` creation after final-answer items so it remains the last active row.

- [ ] **Step 3: Run the focused projection test**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/rows-current.test.ts
```

Expected: all timeline row ordering and tool-state assertions pass.

### Task 3: Restore Elapsed Wording And Empty-Detail Presentation

**Files:**
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`
- Modify: `packages/session-ui/src/components/session-turn.css`

- [ ] **Step 1: Always use the elapsed translation for the top row**

```ts
const label = duration
  ? language.t("ui.sessionTurn.process.elapsed", { duration })
  : language.t("ui.sessionTurn.process.details")
```

- [ ] **Step 2: Remove the `TimelineThinkingRow` renderer and switch case**

Leave `TimelineActivityRow` unchanged so the bottom shimmer status remains independent.

- [ ] **Step 3: Render empty process rows without a blank disclosure**

When `assistantProcessRow().items.length === 0`, render the elapsed label inside a non-interactive element using the process-trigger dimensions. When items exist, retain the current button, chevron, and expandable content.

- [ ] **Step 4: Add a static style state**

Use `data-static` to remove pointer and focus affordances from the empty process row while preserving its typography, height, and divider. Do not change other session-turn spacing.

### Task 4: Verify The Scoped Fix

**Files:**
- Verify: `packages/app/src/pages/session/timeline/rows-current.test.ts`
- Verify: `packages/app/src/pages/session/timeline/model.test.ts`

- [ ] **Step 1: Run focused tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts \
  src/pages/session/timeline/rows-current.test.ts \
  src/pages/session/timeline/model.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run app typecheck**

Run from `packages/app`:

```bash
bun typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run the production renderer build**

Run from `packages/app`:

```bash
bun run build
```

Expected: the production build succeeds.

- [ ] **Step 4: Review the final diff and commit**

```bash
git diff --check
git diff -- packages/app/src/pages/session/timeline packages/session-ui/src/components/session-turn.css
git add packages/app/src/pages/session/timeline/timeline-row.ts \
  packages/app/src/pages/session/timeline/rows.ts \
  packages/app/src/pages/session/timeline/message-timeline.tsx \
  packages/app/src/pages/session/timeline/rows-current.test.ts \
  packages/session-ui/src/components/session-turn.css
git commit -m "fix(app): keep elapsed row above answers"
```

- [ ] **Step 5: Open the latest development app for manual verification**

Verify a text-only reply, a tool-running reply, and a completed reply. Do not create installation packages until the user confirms the behavior.

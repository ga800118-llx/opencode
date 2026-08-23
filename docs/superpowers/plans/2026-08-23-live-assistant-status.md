# Live Assistant Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one animated, ephemeral processing or tool status at the bottom of the active assistant reply.

**Architecture:** Reuse the existing transient timeline activity row, append it after all current answer parts while the active turn is busy, and carry only the latest pending/running tool name. Render the row with the existing `TextShimmer` component and localized labels; remove it naturally when projection status becomes idle.

**Tech Stack:** TypeScript, SolidJS, Effect tagged rows, existing timeline virtualizer, UI i18n dictionaries, Bun test runner.

---

### Task 1: Project And Render One Live Activity Row

**Files:**
- Modify: `packages/app/src/pages/session/timeline/timeline-row.ts`
- Modify: `packages/app/src/pages/session/timeline/rows.ts`
- Modify: `packages/app/src/pages/session/timeline/rows-current.test.ts`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`
- Modify: `packages/app/src/index.css`
- Modify: `packages/ui/src/i18n/en.ts`
- Modify: `packages/ui/src/i18n/zh.ts`
- Modify: `packages/ui/src/i18n/zht.ts`

- [ ] **Step 1: Write failing projection tests**

Add busy text-stream and running-tool cases that require a stable final row:

```ts
expect(result.rows.map(TimelineRow.key)).toEqual([
  "user-message:msg_user",
  "assistant-part:msg_user:msg_assistant:text:0",
  "assistant-activity:msg_user",
])
expect(result.rows.at(-1)).toMatchObject({ _tag: "AssistantActivity", tool: "read" })
```

Also assert that idle, retry, and terminal-error turns do not contain `AssistantActivity`.

- [ ] **Step 2: Run the projection tests and verify they fail**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/rows-current.test.ts
```

Expected: failures because `AssistantActivity` and its key do not exist.

- [ ] **Step 3: Add the stable activity row type**

Replace the narrow `Thinking` row with an activity row that carries only the active tool name:

```ts
export class AssistantActivity extends Data.TaggedClass("AssistantActivity")<{
  userMessageID: string
  tool?: string
  reasoningHeading?: string
}>() {}
```

Return `assistant-activity:${row.userMessageID}` from `TimelineRow.key` and include the class in the row union and `TimelineRowMap`.

- [ ] **Step 4: Append exactly one busy activity row after answer parts**

Select the last tool whose state is `pending` or `running`, then append the stable row only for the active busy turn without an error:

```ts
const tool = assistantPartRefs.findLast(
  (ref) => ref.part.type === "tool" && (ref.part.state.status === "pending" || ref.part.state.status === "running"),
)?.part

if (isActive && status === "busy" && !error) {
  rows.push(new TimelineRow.AssistantActivity({
    userMessageID: userMessage.id,
    tool: tool?.type === "tool" ? tool.tool : undefined,
    reasoningHeading: heading,
  }))
}
```

Keep retry, error, process disclosure, and completed-turn behavior unchanged.

- [ ] **Step 5: Render localized animated labels**

Add `ui.sessionTurn.status.processing` and `ui.sessionTurn.status.callingTool` to English, Simplified Chinese, and Traditional Chinese. In `message-timeline.tsx`, derive the label from the row tool and `getToolInfo(tool).title`, render it through keyed `TextShimmer`, and keep the row's existing fixed minimum height.

- [ ] **Step 6: Add the status-change entrance motion**

Add a selector scoped to `.session-turn-activity-label` with a 160ms opacity entrance and disable it under `prefers-reduced-motion: reduce`. Do not alter shared `TextShimmer` behavior.

- [ ] **Step 7: Run focused verification**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/timeline/rows-current.test.ts src/pages/session/timeline/activity-watchdog.test.ts
bun typecheck
bun run build
```

Expected: all tests and typecheck pass; Vite production build completes with no new errors.

- [ ] **Step 8: Verify the live desktop behavior**

In the running development app, confirm one row remains below streamed text, changes to the active tool without adding rows, uses shimmer/fade motion, and disappears immediately on completion. Confirm the process disclosure and elapsed timer remain unchanged.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/pages/session/timeline/timeline-row.ts \
  packages/app/src/pages/session/timeline/rows.ts \
  packages/app/src/pages/session/timeline/rows-current.test.ts \
  packages/app/src/pages/session/timeline/message-timeline.tsx \
  packages/app/src/index.css \
  packages/ui/src/i18n/en.ts \
  packages/ui/src/i18n/zh.ts \
  packages/ui/src/i18n/zht.ts
git commit -m "feat(app): show live assistant status"
```

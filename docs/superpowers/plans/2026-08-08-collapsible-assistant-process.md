# Collapsible Assistant Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group each turn's reasoning, tools, and intermediate content into one collapsed Codex-style process section with a live or completed elapsed-time label.

**Architecture:** Split grouped assistant items at the trailing run of text parts. Store all preceding items in a stable `AssistantProcess` timeline row and keep trailing text groups as ordinary `AssistantPart` rows. Render the process row with the existing message-part renderers inside an accessible disclosure and reuse the timeline cache for per-turn open state.

**Tech Stack:** TypeScript, SolidJS, Effect data classes, Kobalte-compatible UI primitives, Bun test, CSS

---

### Task 1: Define And Test Process Grouping

**Files:**
- Modify: `packages/app/src/pages/session/timeline/timeline-row.ts`
- Modify: `packages/app/src/pages/session/timeline/rows.ts`
- Modify: `packages/app/src/pages/session/timeline/rows-current.test.ts`

- [x] **Step 1: Add failing row-construction coverage**

Add cases proving that reasoning and tools become one `assistant-process:<user>` row, the trailing text remains an `assistant-part` row, and a text-only answer does not create a process row.

- [x] **Step 2: Run the focused test and verify it fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/pages/session/timeline/rows-current.test.ts
```

Expected: assertions fail because assistant groups are still emitted as independent rows.

- [x] **Step 3: Add the process row and trailing-text split**

Define an `AssistantProcessItem` union for grouped parts and interruption markers, add an `AssistantProcess` tagged row, and split assistant items before row emission. The final-answer suffix is the trailing sequence of part groups whose referenced parts are non-empty text.

- [x] **Step 4: Run the focused test and verify it passes**

Run the command from Step 2. Expected: all row-construction tests pass.

### Task 2: Render The Disclosure And Duration

**Files:**
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`
- Modify: `packages/app/src/pages/session/timeline/projection.ts`
- Modify: `packages/session-ui/src/components/session-turn.css`
- Modify: `packages/ui/src/i18n/*.ts`

- [x] **Step 1: Add process labels**

Add `ui.sessionTurn.process.processing` and `ui.sessionTurn.process.elapsed` translations. English uses `Processing {{duration}}` and `Took {{duration}}`; Simplified Chinese uses `处理中 {{duration}}` and `耗时 {{duration}}`.

- [x] **Step 2: Render one accessible process disclosure**

Render a full-width button with `aria-expanded`, an elapsed label, and a chevron. Render process items in chronological order only while open, reuse `renderAssistantPartGroup`, and keep interruption dividers inside the process body.

- [x] **Step 3: Retain open state and busy tool identity**

Store disclosure state under `process:<userMessageID>` in the existing timeline state cache. Include process groups when deriving the last assistant group key used by busy tool renderers.

- [x] **Step 4: Add restrained Codex-style layout**

Style the header with muted text, a stable 32px hit target, a rotating chevron, and subtle dividers. Keep expanded content unframed and preserve current reasoning/tool typography.

### Task 3: Verify Behavior

**Files:**
- Verify only

- [x] **Step 1: Run focused timeline tests**

From `packages/app` run:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/pages/session/timeline/rows-current.test.ts ./src/pages/session/timeline/projection.test.ts
```

Expected: all selected tests pass.

- [x] **Step 2: Run package type checks**

Run `bun typecheck` from `packages/app`, `packages/session-ui`, and `packages/ui`. Expected: all commands exit 0.

- [x] **Step 3: Inspect the local application**

Open the running application, locate a turn with reasoning or tool content, and verify the disclosure is collapsed by default, the final answer stays visible, the label and chevron update correctly, expansion preserves item order, and no content overlaps after virtualized remeasurement.

- [x] **Step 4: Review the final diff**

Run `git diff --check` and `git status --short`. Expected: no whitespace errors and only intended source, test, translation, style, specification, and plan files are changed, excluding pre-existing unrelated work.

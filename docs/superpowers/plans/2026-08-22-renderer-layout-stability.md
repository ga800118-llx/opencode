# Renderer Layout Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop resize-observer feedback warnings during streamed responses and prevent the desktop development renderer from reloading when Shiki streaming is first reached.

**Architecture:** Use TanStack Virtual's built-in animation-frame resize delivery for the message timeline instead of introducing a second scroll abstraction. Pre-bundle the lazy Shiki stream dependency in the Electron renderer's Vite configuration.

**Tech Stack:** SolidJS, TanStack Virtual, Electron Vite, Playwright, Bun.

---

### Task 1: Reproduce Stream Resize Errors

**Files:**
- Create: `packages/app/e2e/performance/timeline-stability/resize-observer.spec.ts`

- [ ] **Step 1: Write a failing browser test**

Create a timeline with an incomplete assistant text part, subscribe to `pageerror`, stream enough Markdown chunks to repeatedly resize virtual rows, and assert that no error contains `ResizeObserver loop`.

- [ ] **Step 2: Run the focused test and verify the existing implementation fails**

Run from `packages/app`:

```bash
bunx playwright test --config e2e/performance/timeline-stability/playwright.config.ts resize-observer.spec.ts
```

Expected before the fix: the collected browser errors include `ResizeObserver loop completed with undelivered notifications`.

### Task 2: Defer Virtual Timeline Resize Delivery

**Files:**
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`

- [ ] **Step 1: Enable TanStack's supported resize scheduling**

Add the following virtualizer option next to the existing geometry options:

```ts
useAnimationFrameWithResizeObserver: true,
```

- [ ] **Step 2: Re-run the focused browser test**

Run the Task 1 command again. Expected: PASS with no resize-loop page errors.

### Task 3: Pre-optimize Streaming Highlighting

**Files:**
- Modify: `packages/desktop/electron.vite.config.ts`

- [ ] **Step 1: Configure renderer dependency optimization**

Add this renderer configuration before `plugins`:

```ts
optimizeDeps: {
  include: ["@shikijs/stream"],
},
```

- [ ] **Step 2: Verify desktop build and development startup**

Run from `packages/desktop`:

```bash
bun typecheck
bun run build
```

Expected: both commands exit successfully; a development launch must not print `new dependencies optimized: @shikijs/stream` when the first fenced code response renders.

### Task 4: Package Native Deliverables

**Files:**
- No source changes expected.

- [ ] **Step 1: Build and verify the Mac internal beta locally**

Run from `packages/desktop`:

```bash
bun run package:mac:internal
```

Expected: the internal beta directory contains the DMG ZIP, checksum manifest, licenses, and tester guide.

- [ ] **Step 2: Build Windows on a native Windows runner**

Dispatch `.github/workflows/windows-internal-beta.yml` for the current source revision. Expected: the workflow's Windows x64 smoke checks pass and its delivery artifact contains the NSIS installer, portable ZIP, checksum manifest, licenses, and tester guide.

- [ ] **Step 3: Compare artifact provenance**

Confirm both deliveries were built from the same commit and report their absolute output paths and SHA-256 checksums.

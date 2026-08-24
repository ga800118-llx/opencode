# Startup Model And Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the saved default model before the renderer opens and prevent Sidecar restart notices from crashing a restored task.

**Architecture:** Make desktop Sidecar readiness validate the selected runtime provider/model instead of accepting an empty catalog. Replace branch-scoped notice accessors with keyed immutable values so restart-to-ready transitions cannot perform stale reads.

**Tech Stack:** TypeScript, Bun tests, Electron, SolidJS.

---

### Task 1: Validate The Selected Runtime Model During Sidecar Startup

**Files:**
- Modify: `packages/desktop/src/main/sidecar-readiness.ts`
- Test: `packages/desktop/src/main/sidecar-readiness.test.ts`

- [ ] **Step 1: Write the failing readiness tests**

Add a test server that first returns an empty provider catalog and then returns the expected provider with the expected model. Call `waitForSidecarReadiness(..., { expectedModel: "private/model" })` and assert that the function retries. Add coverage for a model ID containing `/`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `bun test src/main/sidecar-readiness.test.ts`

Expected: FAIL because `SidecarReadinessOptions` does not accept `expectedModel` and the empty catalog is accepted too early.

- [ ] **Step 3: Implement exact provider/model readiness**

Parse the expected model at the first `/`, preserving any remaining `/` characters in the model ID. Keep the current catalog-shape validation, then require a matching provider entry and model key only when `expectedModel` is present.

- [ ] **Step 4: Run the focused readiness tests**

Run: `bun test src/main/sidecar-readiness.test.ts`

Expected: PASS.

### Task 2: Feed The Current Runtime Selection Into Every Sidecar Start

**Files:**
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/src/main/sidecar-supervisor.test.ts`

- [ ] **Step 1: Track the last written selected model**

Update the existing runtime-config logging boundary to retain `result.selectedModel` in process memory. Pass that value to `waitForSidecarReadiness` in both V1 and V2 startup branches.

- [ ] **Step 2: Preserve reload ordering**

Confirm that runtime config writes update the retained selection before `restartProductSidecar()` starts. Do not add another profile write or Sidecar restart.

- [ ] **Step 3: Run desktop startup tests**

Run: `bun test src/main/sidecar-readiness.test.ts src/main/sidecar-supervisor.test.ts src/main/index.test.ts`

Expected: PASS.

### Task 3: Remove Stale Notice Accessors

**Files:**
- Modify: `packages/app/src/components/workflow/sidecar-recovery-notice.tsx`
- Modify: `packages/app/src/components/workflow/model-setup-notice.tsx`
- Test: `packages/app/src/components/workflow/sidecar-recovery-notice.test.ts`
- Test: `packages/app/src/components/workflow/model-setup-notice.test.ts`

- [ ] **Step 1: Convert notice branches to keyed values**

Add `keyed` to the outer notice `Show` branches and read the callback value directly. Do the same for nested action branches in the Sidecar notice so no nested computation closes over a parent `Show` accessor.

- [ ] **Step 2: Run focused notice tests**

Run: `bun test src/components/workflow/sidecar-recovery-notice.test.ts src/components/workflow/model-setup-notice.test.ts`

Expected: PASS.

### Task 4: Verify The Scoped Repair

**Files:**
- No additional source files.

- [ ] **Step 1: Run package type checks**

Run `bun typecheck` from `packages/desktop`, then from `packages/app`.

Expected: both commands exit successfully.

- [ ] **Step 2: Run production builds**

Run `bun run build` from `packages/app`, then `bun run build` from `packages/desktop`.

Expected: both builds complete successfully.

- [ ] **Step 3: Check the final diff**

Run `git diff --check` and inspect `git diff --stat`.

Expected: only the two readiness files, desktop startup wiring, the two notice components, tests, and these design/plan documents changed.

- [ ] **Step 4: Start the latest development application**

Run the existing desktop development command with the local model catalog environment. Confirm that a historical task opens with its content and the saved default model is visible. Do not produce installers.

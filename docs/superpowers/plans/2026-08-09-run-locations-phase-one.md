# Run Locations Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide server management from Simple mode and present the unchanged capability as Run locations in Advanced mode.

**Architecture:** Add one pure presentation-policy module under the existing product workflow boundary, then consume it at UI entry points. Keep connection data and server APIs untouched; filtering occurs only in Home presentation and labels are supplied through the existing product copy bundle.

**Tech Stack:** TypeScript, SolidJS, Bun test, Electron Vite

---

### Task 1: Run-location presentation policy

**Files:**
- Create: `packages/app/src/product/workflow/run-location-presentation.ts`
- Create: `packages/app/src/product/workflow/run-location-presentation.test.ts`
- Modify: `packages/app/src/product/workflow/index.ts`

- [ ] Write failing tests for Simple local, Simple remote, Advanced local, Advanced remote, and active-location filtering.
- [ ] Run `bun test src/product/workflow/run-location-presentation.test.ts` from `packages/app` and confirm failure because the module is absent.
- [ ] Implement `createRunLocationPresentation` and `visibleRunLocations` as pure functions.
- [ ] Export the policy from the workflow index.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Settings and command visibility

**Files:**
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `packages/app/src/components/settings-v2/general.tsx`
- Modify: `packages/app/src/pages/layout.tsx`

- [ ] Make the Settings dialog normalize a hidden `servers` tab to `general` in Simple mode.
- [ ] Render the Run locations trigger and panel only when the presentation policy allows management.
- [ ] Hide the title-bar run-status preference in Simple mode.
- [ ] Register the location-switch command only in Advanced mode.
- [ ] Add or update focused component/presentation tests for the visible states.

### Task 3: Home and title-bar behavior

**Files:**
- Modify: `packages/app/src/pages/home/home-controller.ts`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `packages/app/src/pages/new-session/new-session-view.tsx`
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/components/status-popover.tsx`

- [ ] Filter the Home server list through `visibleRunLocations` so Simple mode receives only the active location.
- [ ] Gate status popovers with the presentation policy.
- [ ] Add a compact read-only remote-run indicator for Simple mode.
- [ ] Verify switching modes preserves the active connection and does not mutate saved connections.

### Task 4: Product language

**Files:**
- Modify: `packages/app/src/i18n/workflow-copy.ts`
- Modify: `packages/app/src/components/settings-v2/servers.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-server-v2.tsx`
- Modify: `packages/app/src/components/dialog-select-server.tsx`
- Modify: `packages/app/src/components/server/server-row.tsx`
- Modify: `packages/app/src/components/server/server-row-menu.tsx`
- Modify: `packages/app/src/components/status-popover-body.tsx`

- [ ] Add complete English and Simplified Chinese Run location copy with English fallback for other locales.
- [ ] Replace user-facing V2 server labels with Run location terminology.
- [ ] Display the built-in sidecar as This device / 本机 without changing its persisted identity.
- [ ] Correct startup-default copy so it describes selection behavior without claiming the local service is not initialized.

### Task 5: Verification and desktop package

**Files:**
- No source files expected.

- [ ] Run focused App tests.
- [ ] Run the complete App test suite from `packages/app`.
- [ ] Run `bun typecheck` from `packages/app`, `packages/ui`, `packages/session-ui`, and `packages/desktop` as affected.
- [ ] Build the Electron renderer and package an unsigned Mac directory build.
- [ ] Fully quit any old desktop process, launch the newly built app, and visually verify Simple and Advanced modes.


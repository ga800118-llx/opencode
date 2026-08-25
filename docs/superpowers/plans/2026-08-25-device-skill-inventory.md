# Device Skill Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Skills settings show one device-level inventory from Home or any task while preserving location-scoped Skill execution.

**Architecture:** The settings dialog supplies an ordered list of known location directories. The existing Skill management API is called once per unique directory, and pure app controller logic deduplicates installations by management ID and groups distinct installations by Skill name. Mutations retain the directory that discovered each installation, so no Protocol or Server changes are required.

**Tech Stack:** TypeScript, SolidJS, TanStack Solid Query, Bun tests, Playwright regression tests

---

### Task 1: Resolve Device Skill Locations

**Files:**
- Modify: `packages/app/src/components/settings-directory.ts`
- Modify: `packages/app/src/components/settings-directory.test.ts`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`

- [ ] **Step 1: Write failing directory aggregation tests**

Add tests proving that `settingsSkillDirectories` returns unique paths in this order: active task, recent project, remaining known projects, global config. Add Home and global-only cases.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test src/components/settings-directory.test.ts` from `packages/app`.

Expected: failure because `settingsSkillDirectories` does not exist.

- [ ] **Step 3: Implement ordered unique aggregation**

Replace the single-directory helper with:

```ts
export function settingsSkillDirectories(
  active: string | undefined,
  recent: string | undefined,
  projects: ReadonlyArray<{ worktree: string }>,
  globalConfig: string | undefined,
) {
  return [...new Set([active, recent, ...projects.map((project) => project.worktree), globalConfig].filter(Boolean))]
}
```

Use a type guard instead of a cast so the result is inferred as `string[]`.

- [ ] **Step 4: Pass locations and tab activity into Skills settings**

In `DialogSettings`, derive the location list from `directory()`, `server.projects.last()`, `server.projects.list()`, and `serverSync().data.path.config`. Pass the list plus `active={tab() === "skills"}` to `SettingsSkillsV2`.

- [ ] **Step 5: Run the focused test**

Run: `bun test src/components/settings-directory.test.ts` from `packages/app`.

Expected: all settings-directory tests pass.

### Task 2: Aggregate Logical Device Skills

**Files:**
- Modify: `packages/app/src/components/settings-v2/skills-controller.ts`
- Modify: `packages/app/src/components/settings-v2/skills-controller.test.ts`

- [ ] **Step 1: Add failing aggregation tests**

Cover these cases with decoded `Skill.ManagementInfo` fixtures:

```ts
const result = mergeDeviceSkills([
  { directory: "/one", items: [shared, projectOne] },
  { directory: "/two", items: [shared, projectTwoSameName] },
])
```

Assert that the repeated `shared.id` is counted once, the two distinct same-name project installations produce one row, active status wins for display, and the row retains both installation directories.

- [ ] **Step 2: Run the controller test and verify failure**

Run: `bun test src/components/settings-v2/skills-controller.test.ts` from `packages/app`.

Expected: failure because the device aggregation types and function do not exist.

- [ ] **Step 3: Implement aggregation types and function**

Add focused exported types:

```ts
export type SkillInstallation = { directory: string; item: Skill.ManagementInfo }
export type DeviceSkill = Skill.ManagementInfo & { installations?: readonly SkillInstallation[] }
export type SkillSnapshot = { directory: string; items: readonly Skill.ManagementInfo[] }
```

Implement `mergeDeviceSkills(snapshots)` by deduplicating installations by ID, grouping by exact Skill name, choosing a stable representative with active status first, and projecting logical `enabled`, `status`, and `deletable` fields. Preserve raw `ManagementInfo` objects for the one-directory, one-installation case so existing query-cache behavior remains compatible.

- [ ] **Step 4: Extend filtering to secondary sources**

Update `filterSkills` so text search includes every grouped installation's name, description, location, and source value while status filtering uses the projected logical status.

- [ ] **Step 5: Run controller tests**

Run: `bun test src/components/settings-v2/skills-controller.test.ts` from `packages/app`.

Expected: all controller tests pass.

### Task 3: Load And Manage The Device Inventory

**Files:**
- Modify: `packages/app/src/components/settings-v2/skills.tsx`
- Modify: `packages/app/test-browser/settings-skills.test.ts`

- [ ] **Step 1: Add failing component tests**

Update the harness mount helper to accept `Accessor<readonly string[]>` and an active accessor. Add tests proving:

- Home-style input loads two project directories and renders both project Skills.
- A repeated global installation ID renders once.
- Two distinct installations with one name render one row.
- Toggling a merged row calls `setEnabled` once for each retained installation directory.
- An inactive Skills tab does not request data until activated.

- [ ] **Step 2: Run the browser component test and verify failure**

Run: `bun test test-browser/settings-skills.test.ts` from `packages/app`.

Expected: the new multi-location and inactive-tab tests fail.

- [ ] **Step 3: Implement multi-location queries**

Allow `SettingsSkillsV2` to accept `directories?: readonly string[]`, retain `directory?: string` for focused test compatibility, and compute a unique location list. Use one query key per server scope plus ordered location list and load each location through the existing `skillManagement.list` API before calling `mergeDeviceSkills`.

- [ ] **Step 4: Limit refresh work to the visible Skills tab**

Start the query and refresh lifecycle only when the `active` prop is true. Keep focus, visibility, periodic, and manual refresh behavior once the tab is active.

- [ ] **Step 5: Route mutations to installation locations**

For a merged row, call `setEnabled` for every retained installation with its own directory. Refresh the full inventory after success or partial failure. Keep delete available only when the row represents one deletable installation.

- [ ] **Step 6: Render merged-source metadata**

Keep the existing representative source and scope tags. When a row represents additional installations, append `+N` to the visible source and location summaries and place every source/path in the title text.

- [ ] **Step 7: Run browser component tests**

Run: `bun test test-browser/settings-skills.test.ts` from `packages/app`.

Expected: all Skills component tests pass.

### Task 4: Verify Home And Existing Workflows

**Files:**
- Modify: `packages/app/e2e/regression/skill-refresh.spec.ts`

- [ ] **Step 1: Add a Home device-inventory regression**

Mock two known projects whose management snapshots contain one repeated global installation and separate project installations. Open Settings from Home, select Skills, and assert that the global name appears once and both project-only names appear.

- [ ] **Step 2: Run the regression test**

Run: `bunx playwright test e2e/regression/skill-refresh.spec.ts` from `packages/app`.

Expected: both existing refresh tests and the new Home inventory test pass.

- [ ] **Step 3: Run focused unit and browser tests together**

Run from `packages/app`:

```bash
bun test src/components/settings-directory.test.ts src/components/settings-v2/skills-controller.test.ts
bun test test-browser/settings-skills.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 4: Run typecheck and production build**

Run from `packages/app`:

```bash
bun typecheck
bun run build
```

Expected: both commands exit successfully.

- [ ] **Step 5: Inspect the final diff**

Run `git diff --check` and confirm no Server, Protocol, Core, model, session, or permission files changed.

- [ ] **Step 6: Commit the implementation**

```bash
git add packages/app/src/components/settings-directory.ts \
  packages/app/src/components/settings-directory.test.ts \
  packages/app/src/components/settings-v2/dialog-settings-v2.tsx \
  packages/app/src/components/settings-v2/skills-controller.ts \
  packages/app/src/components/settings-v2/skills-controller.test.ts \
  packages/app/src/components/settings-v2/skills.tsx \
  packages/app/test-browser/settings-skills.test.ts \
  packages/app/e2e/regression/skill-refresh.spec.ts
git commit -m "fix(app): unify device skill inventory"
```

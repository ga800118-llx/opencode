# Unified Skill Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GUaI Code manage the same global and project compatibility Skills that its runtime can use, while protecting shared files from deletion.

**Architecture:** Extend the V2 Skill source model with an explicit shared compatibility origin, register `.agents` and `.claude` sources in the existing configuration plugin, and use the server's global config directory as the Home settings context. Keep enable state in the existing Skill management store and reject shared deletion in the core safety boundary.

**Tech Stack:** TypeScript, Effect, SolidJS, Bun tests, generated Effect/Promise clients, Electron desktop QA.

---

### Task 1: Model shared Skill sources

**Files:**

- Modify: `packages/schema/src/skill.ts`
- Modify: `packages/core/src/skill/management.ts`
- Test: `packages/core/test/skill.test.ts`

- [ ] **Step 1: Write failing source and deletion tests**

Add a table entry whose directory source has
`origin: { type: "external", scope: "global", value: "/home/test/.agents/skills" }`.
Assert that management projects `source.type === "external"`,
`deleteBlocked === "shared"`, and `deletable === false`. Assert that calling
`remove` fails with `SkillV2.ProtectedError` carrying reason `shared`.

- [ ] **Step 2: Run the focused core test**

Run: `cd packages/core && bun test ./test/skill.test.ts`

Expected: failure because `external` and `shared` are not schema members.

- [ ] **Step 3: Extend schemas and the safety boundary**

Add `external` to `SourceOrigin.type` and `ManagementSource.type`, and add
`shared` to `DeleteBlocked`. Map external sources to the external management
source. Return the shared block from both deletion projection and mutation
validation before any filesystem preparation.

- [ ] **Step 4: Run the focused core test again**

Run: `cd packages/core && bun test ./test/skill.test.ts`

Expected: all Skill core tests pass.

### Task 2: Register compatibility directories in the authoritative registry

**Files:**

- Modify: `packages/core/src/flag/flag.ts`
- Modify: `packages/core/src/config/plugin/skill.ts`
- Modify: `packages/core/src/skill.ts`
- Test: `packages/core/test/config/skill.test.ts`
- Test: `packages/core/test/skill.test.ts`

- [ ] **Step 1: Extend the configuration plugin test**

Provide an FS service whose upward search finds project `.claude` and `.agents`
directories. Assert source order begins with global compatibility directories,
then project compatibility directories, followed by existing config sources.

- [ ] **Step 2: Run the configuration plugin test**

Run: `cd packages/core && bun test ./test/config/skill.test.ts`

Expected: failure because the V2 plugin does not register compatibility roots.

- [ ] **Step 3: Implement registration and origin preservation**

Expose dynamic core flags for external and Claude Skill discovery. Register
global compatibility roots and upward-discovered project roots with external
origin metadata. When a source path is registered more than once, retain an
existing external origin so a config declaration cannot make a shared path
deletable.

- [ ] **Step 4: Verify registry tests**

Run: `cd packages/core && bun test ./test/config/skill.test.ts ./test/skill.test.ts`

Expected: all tests pass.

### Task 3: Make registry reads wait for required Skill registrations

**Files:**

- Modify: `packages/core/src/skill/guidance.ts`
- Modify: `packages/server/src/handlers/skill.ts`
- Test: `packages/opencode/test/server/httpapi-v2-location.test.ts`

- [ ] **Step 1: Add a server test for a cold location**

Issue the first management request for a fresh location and assert the response
contains the built-in Skill plus a compatibility Skill installed under the
fixture home directory.

- [ ] **Step 2: Run the server test**

Run: `cd packages/opencode && bun test ./test/server/httpapi-v2-location.test.ts`

Expected: the compatibility Skill is absent or the cold response races plugin
registration.

- [ ] **Step 3: Wait for required plugins at read boundaries**

Before server Skill list or management operations, wait for the `skill` and
`config-skill` plugin IDs. Do the same before Skill guidance snapshots the
registry for a model turn.

- [ ] **Step 4: Verify the server test**

Run: `cd packages/opencode && bun test ./test/server/httpapi-v2-location.test.ts`

Expected: all location API tests pass deterministically.

### Task 4: Show global Skills from Home

**Files:**

- Modify: `packages/app/src/components/settings-directory.ts`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `packages/app/src/components/settings-v2/skills-controller.ts`
- Modify: `packages/app/src/i18n/*.ts`
- Test: `packages/app/src/components/settings-directory.test.ts`
- Test: `packages/app/src/components/settings-v2/skills-controller.test.ts`
- Test: `packages/app/test-browser/settings-skills.test.ts`

- [ ] **Step 1: Add failing app tests**

Assert external sources map to the shared-source translation key and shared
deletion blocks map to their explanatory key. Assert the settings-directory
resolver uses a server path such as `/config/opencode` as the Skill management
context when there is no selected project.

- [ ] **Step 2: Run focused app tests**

Run: `cd packages/app && bun test ./src/components/settings-v2/skills-controller.test.ts`

Run: `cd packages/app && bun test --conditions=browser --preload ./happydom.ts ./test-browser/settings-skills.test.ts`

Expected: failures for the missing mappings and Home fallback.

- [ ] **Step 3: Implement the Home context and copy**

Use the active route directory when present; otherwise pass the synchronized
server global config directory to `SettingsSkillsV2`. Add localized shared
source and shared-deletion explanations, using Chinese copy in `zh`/`zht` and
English fallback copy in the other locale overlays.

- [ ] **Step 4: Verify focused app tests and parity**

Run: `cd packages/app && bun test ./src/components/settings-v2/skills-controller.test.ts ./src/i18n/parity.test.ts`

Run: `cd packages/app && bun test --conditions=browser --preload ./happydom.ts ./test-browser/settings-skills.test.ts`

Expected: Skill tests pass; any pre-existing unrelated parity failure is
reported separately with exact missing keys.

### Task 5: Regenerate contracts and complete verification

**Files:**

- Regenerate: `packages/client/src/generated/**`
- Regenerate: `packages/client/src/generated-effect/**`

- [ ] **Step 1: Regenerate public clients**

Run: `cd packages/client && bun run generate`

Expected: generated Skill enum schemas include `external` and `shared`.

- [ ] **Step 2: Run package verification**

Run `bun typecheck` from `packages/schema`, `packages/core`,
`packages/protocol`, `packages/server`, `packages/opencode`,
`packages/client`, and `packages/app`. Run the focused core, server, client,
and app tests from their package directories, followed by
`cd packages/client && bun run check:generated`.

Expected: all affected-package checks pass, apart from explicitly identified
pre-existing unrelated failures.

- [ ] **Step 3: Verify the real desktop workflow**

Open Settings > Skills from Home. Confirm `agent-browser` is listed as a global
shared source, has an enable switch and no delete action. Disable and re-enable
it, verify `/api/skill` follows the state, and verify
`~/.agents/skills/agent-browser/SKILL.md` remains present. Repeat in an active
project and inspect compact and standard desktop layouts.

- [ ] **Step 4: Audit and commit only task-owned changes**

Run `git diff --check`, inspect the staged diff against the design, preserve
unrelated worktree edits, and commit with:

```bash
git commit -m "fix(app): unify skill management sources"
```

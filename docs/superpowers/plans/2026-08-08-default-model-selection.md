# Default Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any selected model in a saved model source become the application's default without requiring an agent-capable capability report.

**Architecture:** Keep model ownership validation in the model-center config layer, but remove capability-report validation from both the config patch builder and the model-profile form controller. Capability testing and status presentation remain independent. Update the empty-state copy so the interface describes new-task selection instead of a testing prerequisite.

**Tech Stack:** TypeScript, SolidJS, Bun test, OpenCode configuration APIs

---

### Task 1: Relax Configuration Validation

**Files:**
- Modify: `packages/app/src/product/model-center/config.test.ts`
- Modify: `packages/app/src/product/model-center/config.ts`

- [ ] **Step 1: Replace the restrictive config test**

Replace the test that expects `manual-coder` to be rejected with coverage for an untested member model and a missing model:

```ts
test("allows any model in the profile to become the default", () => {
  expect(defaultModelPatch(profile, "manual-coder")).toEqual({
    model: `${profile.providerID}/manual-coder`,
  })
})

test("refuses to make a model outside the profile the default", () => {
  expect(() => defaultModelPatch(profile, "missing-coder")).toThrow(
    "The default model must belong to this profile.",
  )
})
```

- [ ] **Step 2: Run the focused test and verify the new expectation fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/product/model-center/config.test.ts
```

Expected: the untested member-model test fails because `defaultModelPatch` still requires an `agent-capable` report.

- [ ] **Step 3: Remove capability validation from the config patch**

Change `defaultModelPatch` to validate only model ownership:

```ts
export function defaultModelPatch(profile: ProductProviderProfile, modelID: string) {
  if (!profile.models.some((model) => model.id === modelID)) {
    throw new Error("The default model must belong to this profile.")
  }
  return Object.freeze({ model: `${profile.providerID}/${modelID}` })
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run the command from Step 2. Expected: all tests in `config.test.ts` pass.

### Task 2: Enable The Editor Action Without A Capability Report

**Files:**
- Modify: `packages/app/src/components/settings-v2/model-center-controller.test.ts`
- Modify: `packages/app/src/components/settings-v2/model-center-controller.ts`

- [ ] **Step 1: Replace the controller capability-gate test**

Cover untested and limited models while preserving the saved-profile requirement:

```ts
test("allows any selected model in a saved profile to become the default", async () => {
  const { form, defaults } = fixture({ profile })
  form.selectModel("coder")
  form.setTestReport(undefined)

  expect(form.canSelectDefault()).toBe(true)
  await form.selectDefault()
  expect(defaults).toEqual([{ profileID: profile.id, modelID: "coder" }])

  form.setTestReport({
    ...agentReport,
    classification: "chat-only",
    checks: { basicChat: true, streaming: false, toolCalling: false },
  })
  expect(form.canSelectDefault()).toBe(true)
})
```

Keep or add an assertion that a create-mode form without `profileID` cannot select a default.

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/components/settings-v2/model-center-controller.test.ts
```

Expected: the untested-profile assertion fails because `canSelectDefault()` still requires an `agent-capable` report.

- [ ] **Step 3: Simplify the button gate and fallback error**

Make `canSelectDefault()` depend only on saved edit mode, a selected model, and idle save/delete state:

```ts
canSelectDefault() {
  return Boolean(state.profileID && state.selectedModelID && !state.saving && !state.deleting)
},
```

Change the defensive `selectDefault()` error to:

```ts
throw recordError(new Error("Choose a model from a saved model source before making it the default."))
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run the command from Step 2. Expected: all tests in `model-center-controller.test.ts` pass.

### Task 3: Correct The Default-Model Explanation

**Files:**
- Create: `packages/app/src/i18n/model-center-copy.test.ts`
- Modify: `packages/app/src/i18n/model-center-copy.ts`

- [ ] **Step 1: Add copy assertions**

Create a focused test:

```ts
import { expect, test } from "bun:test"
import { modelCenterEn, modelCenterZh } from "./model-center-copy"

test("describes the default as the model selected for new tasks", () => {
  expect(modelCenterEn["settings.modelCenter.default.emptyDescription"]).toBe(
    "Choose the model to use by default for new tasks.",
  )
  expect(modelCenterZh["settings.modelCenter.default.emptyDescription"]).toBe("选择新任务默认使用的模型。")
})
```

- [ ] **Step 2: Run the copy test and verify it fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/i18n/model-center-copy.test.ts
```

Expected: both assertions fail with the old capability-testing prerequisite copy.

- [ ] **Step 3: Update English and Chinese copy**

Set the two translations to the exact strings asserted in Step 1.

- [ ] **Step 4: Run the copy test and verify it passes**

Run the command from Step 2. Expected: the copy test passes.

### Task 4: Verify The Integrated Behavior

**Files:**
- Modify: `packages/app/src/product/model-center/controller.test.ts`
- Modify: `packages/app/src/product/model-center/controller.ts`

- [ ] **Step 1: Prove default selection does not require a provider refresh**

Update the default-selection call-order assertion to expect only the operations that belong to the transaction:

```ts
expect(selecting.calls).toEqual(["list", "select-default", "update-config"])
```

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/product/model-center/controller.test.ts
```

Expected: the assertion fails because the controller still calls `refreshProviders` after the global config write.

- [ ] **Step 2: Remove the redundant refresh from default selection**

Keep the default selection transaction focused on the profile selection and global config update:

```ts
const selected = await safe(() => options.modelCenter.selectDefault(input))
await safe(() => options.updateConfig(defaultModelPatch(selected, input.modelID)))
return selected
```

Run the command from Step 1. Expected: all tests in `controller.test.ts` pass.

- [ ] **Step 3: Run the relevant unit tests together**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts \
  ./src/product/model-center/config.test.ts \
  ./src/product/model-center/controller.test.ts \
  ./src/components/settings-v2/model-center-controller.test.ts \
  ./src/i18n/model-center-copy.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 4: Run the package typecheck**

Run from `packages/app`:

```bash
bun typecheck
```

Expected: exit code 0.

- [ ] **Step 5: Check the desktop interaction**

In the running desktop development app, open **Settings > Models**, edit the private endpoint, select `DeepSeek V4 Pro`, and confirm **Make default** is enabled without running the capability test. Click it and verify the Default model row shows `DeepSeek V4 Pro`.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only the intended source, test, copy, and plan files are modified, excluding the pre-existing untracked `.superpowers/` directory.

### Task 5: Remove The Desktop Host Capability Gate

**Files:**
- Modify: `packages/desktop/src/main/model-center/service.test.ts`
- Modify: `packages/desktop/src/main/model-center/service.ts`

- [ ] **Step 1: Replace the desktop rejection expectation**

Change the service coverage to prove both an untested model and a `chat-only` tested model can be selected as defaults:

```ts
test("allows untested and non-agent-capable models as defaults", async () => {
  const untested = fixture()
  const untestedProfile = await untested.service.save(draft)
  expect(await untested.service.selectDefault({ profileID: untestedProfile.id, modelID: "coder" })).toMatchObject({
    defaultModelID: "coder",
  })

  const partial = fixture({ classification: "chat-only" })
  const partialProfile = await partial.service.save(draft)
  await partial.service.test({ profileID: partialProfile.id, modelID: "coder" })
  expect(await partial.service.selectDefault({ profileID: partialProfile.id, modelID: "coder" })).toMatchObject({
    defaultModelID: "coder",
  })
})
```

Keep credential rollback coverage as a separate test.

- [ ] **Step 2: Run the focused desktop test and verify it fails**

Run from `packages/desktop`:

```bash
bun test ./src/main/model-center/service.test.ts
```

Expected: untested and `chat-only` default selection fail with the old agent-capability requirement.

- [ ] **Step 3: Remove the desktop capability check**

Keep profile existence validation and delegate model ownership validation to `profiles.selectDefault`:

```ts
async selectDefault(input) {
  const profile = options.profiles.get(input.profileID)
  if (!profile) throw new Error("The model profile does not exist.")
  return present(options.profiles.selectDefault(input))
},
```

- [ ] **Step 4: Run desktop verification**

Run from `packages/desktop`:

```bash
bun test ./src/main/model-center/service.test.ts
bun typecheck
```

Expected: the focused service tests and desktop typecheck pass.

- [ ] **Step 5: Repeat the desktop interaction check**

Restart the desktop development process so the Electron main process loads the service change. Open **Settings > Models**, edit the private endpoint, select `DeepSeek V4 Pro`, click **Make default**, and verify the success toast appears with no diagnostic feedback.

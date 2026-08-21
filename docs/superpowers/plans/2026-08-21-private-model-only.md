# Private-Model-Only Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every built-in system model from Guai Code desktop so only user-configured models can be loaded, selected, and used.

**Architecture:** Keep the desktop model-profile repository as the sole model source. Generate an isolated OpenCode configuration whose provider allowlist exactly matches presented user profiles, including an explicit empty allowlist when none exist. Reuse the existing model-readiness and settings entry points, while making submit-time feedback distinguish an unconfigured model from a missing agent.

**Tech Stack:** TypeScript, Bun test, Electron desktop runtime, SolidJS application, OpenCode provider configuration.

---

## File Map

- Modify `packages/desktop/src/main/model-center/runtime-config.ts`: serialize only user profiles and private defaults.
- Modify `packages/desktop/src/main/model-center/runtime-config.test.ts`: define private-only configuration and manifest expectations.
- Delete `packages/desktop/src/main/model-center/system-models.ts`: remove obsolete built-in constants.
- Delete `packages/desktop/src/main/model-center/system-models.test.ts`: remove obsolete allowlist coverage.
- Modify `packages/desktop/src/main/model-center/service.test.ts`: update integrated reload expectations to exclude system models.
- Modify `packages/app/src/components/prompt-input/submit.ts`: show model-setup feedback when no model exists.
- Modify `packages/app/src/components/prompt-input/submit.test.ts`: prove unconfigured submission is blocked before task creation.
- Modify `packages/app/src/product/workflow/model-readiness.test.ts`: remove built-in-model terminology from readiness coverage.

### Task 1: Define Private-Only Runtime Behavior in Tests

**Files:**
- Modify: `packages/desktop/src/main/model-center/runtime-config.test.ts`
- Modify: `packages/desktop/src/main/model-center/service.test.ts`

- [ ] **Step 1: Replace system-provider expectations in runtime tests**

Remove the `system-models` import. Update the explicit-default test to expect only serialized private providers:

```ts
expect(config).toEqual({
  provider: {
    [first.providerID]: serializeProviderProfile(presentProfile(first)),
    [second.providerID]: serializeProviderProfile(presentProfile(second)),
  },
  enabled_providers: [first.providerID, second.providerID],
  disabled_providers: [],
  model: `${second.providerID}/precise`,
})
```

Change the empty-profile case to prove the provider catalog is disabled and no default is emitted:

```ts
expect(
  createProductRuntimeConfig({
    profiles: [],
    defaultSelection: undefined,
    presentProfile: (item) => item,
  }),
).toEqual({
  provider: {},
  enabled_providers: [],
  disabled_providers: [],
})
```

For a saved profile with no models, expect that profile to remain enabled but expect `model` to be absent. Update manifest expectations to `selectedModel: null`.

- [ ] **Step 2: Update manifest and reload counts**

Every count must represent only private data. For a profile with two models, use:

```ts
const expectedResult = {
  profileCount: 1,
  providerCount: 1,
  modelCount: 2,
  selectedModel: `${current.providerID}/reviewer`,
}
```

Apply the same subtraction to later queued-write and manifest assertions. Keep the seven-private-model test unchanged except for verifying that the provider count is one.

- [ ] **Step 3: Update the service integration assertion**

Remove the `system-models` import and assert that only surviving user profiles reach the runtime:

```ts
expect(Object.keys(overlay.provider).sort()).toEqual(
  [selected.providerID, saved.providerID, tested.providerID].sort(),
)
expect(JSON.parse(await readFile(paths.manifest, "utf8"))).toMatchObject({
  counts: { profiles: 3, providers: 3, models: 4 },
  selectedModel: `${selected.providerID}/coder`,
})
```

- [ ] **Step 4: Run the focused tests and confirm they fail for system injection**

Run from `packages/desktop`:

```bash
bun test src/main/model-center/runtime-config.test.ts src/main/model-center/service.test.ts
```

Expected: failures show the extra `opencode` provider, five extra models, and system fallback model still produced by `runtime-config.ts`.

### Task 2: Remove System Models from Runtime Generation

**Files:**
- Modify: `packages/desktop/src/main/model-center/runtime-config.ts`
- Delete: `packages/desktop/src/main/model-center/system-models.ts`
- Delete: `packages/desktop/src/main/model-center/system-models.test.ts`

- [ ] **Step 1: Narrow the runtime configuration type**

Remove the system-model import and define the provider map exclusively in terms of serialized profiles:

```ts
export type ProductRuntimeConfig = {
  readonly provider: Readonly<Record<string, ProductOpenCodeProviderConfig>>
  readonly enabled_providers: readonly string[]
  readonly disabled_providers: readonly string[]
  readonly model?: string
}
```

- [ ] **Step 2: Serialize exactly the presented profiles**

Keep existing explicit-default validation and first-private-model fallback, then return:

```ts
return Object.freeze({
  provider: Object.freeze(
    Object.fromEntries(
      profiles.map((profile) => [profile.presented.providerID, serializeProviderProfile(profile.presented)]),
    ),
  ),
  enabled_providers: Object.freeze(profiles.map((profile) => profile.presented.providerID)),
  disabled_providers: Object.freeze([]),
  ...(selected ? { model: `${selected.profile.providerID}/${selected.modelID}` } : {}),
})
```

The conditional spread must omit `model` completely when no private model exists.

- [ ] **Step 3: Count only serialized private models**

Replace the system-aware reducer with:

```ts
const counts = Object.freeze({
  profiles: input.profiles.length,
  providers: Object.keys(config.provider).length,
  models: Object.values(config.provider).reduce(
    (total, provider) => total + Object.keys(provider.models).length,
    0,
  ),
})
```

- [ ] **Step 4: Delete obsolete system-model files**

Delete `system-models.ts` and `system-models.test.ts`, then verify no production or test reference remains:

```bash
rg -n "SYSTEM_PROVIDER|SYSTEM_MODEL|system-models" packages/desktop/src
```

Expected: no matches.

- [ ] **Step 5: Run desktop model-center tests**

Run from `packages/desktop`:

```bash
bun test src/main/model-center/runtime-config.test.ts src/main/model-center/service.test.ts
```

Expected: all tests pass.

### Task 3: Make the Unconfigured Submit State Explicit

**Files:**
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/components/prompt-input/submit.test.ts`
- Modify: `packages/app/src/product/workflow/model-readiness.test.ts`

- [ ] **Step 1: Add a failing unconfigured-model submit test**

Create a submit controller with an injected empty model selection and verify no task is created:

```ts
test("blocks submission and directs the user to configure a model", async () => {
  const model = {
    current: () => undefined,
    variant: { current: () => undefined },
  } as unknown as ModelSelection
  const submit = createPromptSubmit({
    prompt,
    info: () => undefined,
    imageAttachments: () => [],
    commentCount: () => 0,
    autoAccept: () => false,
    mode: () => "normal",
    working: () => false,
    editor: () => undefined,
    queueScroll: () => undefined,
    promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
    addToHistory: () => undefined,
    resetHistoryNavigation: () => undefined,
    setMode: () => undefined,
    setPopover: () => undefined,
    model,
  })

  await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

  expect(createdSessions).toEqual([])
  expect(sentPrompts).toEqual([])
  expect(toasts).toEqual([
    {
      title: "workflow.modelSetup.action",
      description: "workflow.modelSetup.description",
    },
  ])
})
```

- [ ] **Step 2: Run the submit test and confirm the generic toast fails**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/prompt-input/submit.test.ts
```

Expected: the new test fails because submit currently uses `prompt.toast.modelAgentRequired.*`.

- [ ] **Step 3: Split model and agent validation**

Change the pre-submit guard to:

```ts
if (!currentModel) {
  showToast({
    title: language.t("workflow.modelSetup.action"),
    description: language.t("workflow.modelSetup.description"),
  })
  return
}
if (!currentAgent) {
  showToast({
    title: language.t("prompt.toast.modelAgentRequired.title"),
    description: language.t("prompt.toast.modelAgentRequired.description"),
  })
  return
}
```

This reuses the localized copy already shown by the home and new-task setup notice.

- [ ] **Step 4: Remove built-in terminology from readiness tests**

Rename the readiness test from `accepts a usable selected or built-in model without setup` to:

```ts
test("accepts a usable selected model without setup", () => {
```

No readiness implementation change is required because its model-count behavior already represents synchronized private models after the runtime fix.

- [ ] **Step 5: Run focused app tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts \
  src/components/prompt-input/submit.test.ts \
  src/product/workflow/model-readiness.test.ts \
  src/components/workflow/model-setup-notice.test.ts
```

Expected: all tests pass.

### Task 4: Cross-Package Verification

**Files:**
- Verify all files changed in Tasks 1-3.

- [ ] **Step 1: Verify removed symbols and product wording**

Run from the repository root:

```bash
rg -n "SYSTEM_PROVIDER|SYSTEM_MODEL|system-models|curated system models" packages/desktop/src packages/app/src
```

Expected: no active source or test references.

- [ ] **Step 2: Run package type checks**

Run separately from each package directory:

```bash
cd packages/desktop && bun typecheck
cd packages/app && bun typecheck
```

Expected: both commands exit successfully.

- [ ] **Step 3: Run the focused regression set once more**

Run the desktop model-center tests from `packages/desktop` and the three application tests from `packages/app` using the commands above.

Expected: all focused tests pass with no retries.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git diff -- packages/desktop/src/main/model-center packages/app/src/components/prompt-input/submit.ts packages/app/src/components/prompt-input/submit.test.ts packages/app/src/product/workflow/model-readiness.test.ts
```

Expected: no whitespace errors; the diff contains only private-model runtime behavior, focused UX copy selection, and tests.

- [ ] **Step 5: Record manual validation scope**

Report that automated package checks are complete. Leave packaged Mac and Windows clean-install testing, private endpoint credential entry, and long-running performance validation for the user's separate manual test pass, as requested.

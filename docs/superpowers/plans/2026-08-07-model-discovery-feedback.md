# Model Discovery Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `subagent-driven-development` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model discovery visibly report validation, progress, success,
and failure while keeping large model catalogs searchable and scrollable in the
create/edit dialog.

**Architecture:** Extend the existing model-profile form controller with a
typed discovery-feedback union and an ephemeral model query. Treat discovery
as a transaction: diagnostics preserve current models, while successful
responses reconcile discovered and manual models. Keep persistence and desktop
probe contracts unchanged; render localized feedback and bounded scrolling in
the existing SolidJS dialog.

**Tech Stack:** Bun, TypeScript, SolidJS, Electron, existing V2 UI primitives,
Bun test with happy-dom, Agent Browser.

---

## Write Boundaries

- Modify: `packages/app/src/components/settings-v2/model-center-controller.ts`
- Modify: `packages/app/src/components/settings-v2/model-center-controller.test.ts`
- Modify: `packages/app/src/components/settings-v2/dialog-model-profile.tsx`
- Modify: `packages/app/src/components/settings-v2/settings-v2.css`
- Modify: `packages/app/src/i18n/model-center-copy.ts`
- Modify: `packages/app/src/i18n/parity.test.ts` only if the existing parity
  harness requires an explicit update
- Create or modify focused renderer test/story files only when needed for
  visible-state assertions
- Modify: `docs/product/phase-3/verification.md` only for final evidence notes

Do not modify `packages/core`, `packages/opencode`, `packages/server`,
`packages/protocol`, generated clients, credential storage, IPC, or model probe
request behavior.

## Invariants

1. API keys remain closure-held and never enter Solid state, rendered text,
   logs, snapshots, or serialized profile data.
2. A diagnostic discovery response does not change models, selection, or the
   last capability report.
3. A successful discovery replaces only the discovered subset and retains
   manual models.
4. Stale response generations cannot change results or feedback.
5. Search is presentation-only and never changes saved models.
6. Existing save, test, default-selection, delete, and local-detection
   behavior remains intact.

### Task 1: Add Transactional Discovery State

**Files:**

- Modify: `packages/app/src/components/settings-v2/model-center-controller.ts`
- Modify: `packages/app/src/components/settings-v2/model-center-controller.test.ts`

- [ ] **Step 1: Write failing controller tests**

Add focused tests that assert:

```ts
expect(form.state.discoveryFeedback).toEqual({ type: "success", count: 2 })
expect(form.filteredModels().map((model) => model.id)).toEqual(["reasoner"])
```

Cover name search, ID search, case-insensitive search, and empty search. Add a
diagnostic result test with an existing selected model:

```ts
discovery.resolve({
  models: [],
  requestID: "req-auth",
  diagnostic: {
    kind: "authentication",
    message: "The model service rejected the saved credentials.",
    detail: "Update the saved credentials for this model, then retry.",
    requestID: "req-auth",
    status: 401,
  },
})

expect(form.state.models).toEqual(before)
expect(form.state.selectedModelID).toBe("coder")
expect(form.state.discoveryFeedback?.type).toBe("diagnostic")
```

Add malformed endpoint coverage that confirms the operation is not called and
sets `{ type: "invalid-endpoint" }`. Extend the stale-response test so the old
response cannot replace the newest feedback.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/components/settings-v2/model-center-controller.test.ts
```

Expected: FAIL because `discoveryFeedback`, `setModelQuery`, and
`filteredModels` do not exist and diagnostics currently replace discovered
models with an empty list.

- [ ] **Step 3: Add the typed feedback state**

Introduce a focused union near `FormState`:

```ts
export type ModelDiscoveryFeedback =
  | { readonly type: "invalid-endpoint" }
  | { readonly type: "success"; readonly count: number }
  | { readonly type: "diagnostic"; readonly diagnostic: ProductModelDiagnostic }
  | { readonly type: "unexpected" }
```

Add `modelQuery: string` and optional `discoveryFeedback` to `FormState`. Add
`setModelQuery` and `filteredModels` methods. Filtering trims and lowercases the
query and matches both `model.name` and `model.id`.

- [ ] **Step 4: Make discovery transactional**

Before calling the operation, validate that the endpoint is an HTTP(S) URL
without embedded credentials. Invalid input sets `invalid-endpoint` and returns
without a request.

When `result.diagnostic` exists, set diagnostic feedback and return without
touching models. On success, preserve manual entries, reconcile discovered
entries, retain the current selection when it still exists, and record the
returned discovered count. Unexpected thrown errors set `unexpected`, use the
existing secret redaction path, and rethrow a safe error.

- [ ] **Step 5: Run focused tests and type checking**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/components/settings-v2/model-center-controller.test.ts
bun typecheck
```

Expected: controller tests and App type check pass.

### Task 2: Render Visible Localized Discovery Feedback

**Files:**

- Modify: `packages/app/src/components/settings-v2/dialog-model-profile.tsx`
- Modify: `packages/app/src/i18n/model-center-copy.ts`
- Test: `packages/app/src/i18n/parity.test.ts`

- [ ] **Step 1: Add complete English and Chinese copy**

Add matching catalog entries for progress, success, zero models, malformed
endpoint, authentication, unreachable endpoint, incompatible API, timeout,
TLS, missing model, cancelled request, and unexpected failure. Include:

```ts
"settings.modelCenter.discovery.success": "Found {{count}} models",
"settings.modelCenter.discovery.incompatible":
  "This address did not return a compatible model API. Check the base URL and whether /v1 is required.",
"settings.modelCenter.discovery.search": "Search model name or ID",
"settings.modelCenter.discovery.searchEmpty": "No models match this search.",
```

Provide direct Simplified Chinese equivalents and preserve exact catalog key
parity.

- [ ] **Step 2: Add the visible status presentation**

Replace the discovery button's fire-and-forget handler with a narrow async
handler that awaits `form.discover()` and scrolls the resulting status block
into the nearest visible position on the next animation frame.

Render one status block immediately below the discovery/manual controls:

```tsx
<Show when={discoveryStatus()}>
  {(status) => (
    <div
      ref={discoveryStatusElement}
      class="model-profile-discovery-status"
      data-tone={status().tone}
      role="status"
      aria-live={status().tone === "error" ? "assertive" : "polite"}
    >
      {status().message}
    </div>
  )}
</Show>
```

Map only safe diagnostic kinds to localized copy. Do not render raw diagnostic
messages, response bodies, credentials, or headers.

- [ ] **Step 3: Render count, search, and filtered results**

When models exist, render a search input with an accessible label and bind it
to `form.setModelQuery`. Change the list iteration to
`<For each={form.filteredModels()}>`. Render the search-empty state separately
from the no-models-yet state. Preserve radio selection and remove actions.

- [ ] **Step 4: Run localization and controller tests**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/i18n/parity.test.ts \
  ./src/components/settings-v2/model-center-controller.test.ts
bun typecheck
```

Expected: catalogs have exact parity and the dialog compiles without widening
the product host or model-center contracts.

### Task 3: Fix Dialog And Long-List Scrolling

**Files:**

- Modify: `packages/app/src/components/settings-v2/settings-v2.css`
- Modify or create: focused settings V2 story/test only if needed for renderer
  fixture coverage

- [ ] **Step 1: Override the dialog-body overflow at the correct specificity**

Use the model-profile dialog classes and V2 slot selectors so the local rule
beats the generic V2 dialog's `overflow: hidden` without changing every dialog:

```css
[data-component="dialog-v2"]
  [data-slot="dialog-content"].model-profile-dialog
  > [data-slot="dialog-body"].model-profile-dialog-body {
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
```

- [ ] **Step 2: Bound and stabilize the model list**

Add independent scrolling and fixed row dimensions:

```css
.model-profile-model-list {
  max-height: clamp(280px, 38vh, 340px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.model-profile-model-row {
  min-height: 52px;
  flex: 0 0 auto;
}
```

Style the search input and status block without nesting cards. Ensure error,
success, and progress states differ by icon/text and not color alone.

- [ ] **Step 3: Build App and inspect generated CSS**

```bash
cd packages/app
bun run build
```

Expected: build passes and the model-profile selector appears after or with
higher specificity than the generic dialog-body overflow rule.

### Task 4: Desktop Regression Verification

**Files:**

- Modify: `docs/product/phase-3/verification.md` only when recording final
  evidence

- [ ] **Step 1: Run package test and type gates**

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  ./src/components/settings-v2/model-center-controller.test.ts \
  ./src/product/model-center \
  ./src/i18n/parity.test.ts
bun typecheck

cd ../desktop
bun test src/main/model-center src/product/host.test.ts src/preload/product-host.test.ts
bun typecheck
```

Expected: all focused App/Desktop tests and both package type checks pass.

- [ ] **Step 2: Build and package the desktop candidate**

```bash
cd packages/desktop
bun run build
bun run package:mac --arm64
```

Expected: packaged macOS arm64 development app is produced successfully.

- [ ] **Step 3: Verify error states in the packaged app**

Using an isolated onboarding profile, verify malformed URL, unreachable host,
correct endpoint with rejected fake credential, and HTML/non-API route. Every
case must display localized feedback adjacent to Discover models without
manual scrolling. Do not use or inspect the user's saved key.

- [ ] **Step 4: Verify 1, 33, and 100 model fixtures**

For each fixture, confirm the discovered count, first-row visibility, search by
name and ID, wheel/trackpad scrolling, keyboard reachability, last-row access,
and non-overlapping footer at compact and standard viewport sizes.

- [ ] **Step 5: Run secret and protected-runtime checks**

```bash
git diff --check
git diff --name-only origin/dev...HEAD -- packages/core packages/opencode packages/server packages/protocol
rg -n "sk-[A-Za-z0-9_-]{12,}" packages/app packages/desktop docs/product/phase-3
```

Expected: no whitespace errors, no new protected-runtime changes for this
feature, and no credential-shaped values in changed source or evidence.

- [ ] **Step 6: Commit the implementation**

```bash
git add packages/app/src/components/settings-v2 \
  packages/app/src/i18n/model-center-copy.ts \
  docs/product/phase-3/verification.md
git commit -m "fix(app): make model discovery results visible"
```

Expected: one focused implementation commit following the approved design.

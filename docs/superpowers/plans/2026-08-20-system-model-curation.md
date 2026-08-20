# System Model Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose exactly five no-configuration system models while preserving every user-managed model.

**Architecture:** Keep the existing public model snapshot for provider metadata, but enforce an `opencode` model whitelist in both V1 and V2 configuration paths before models reach the UI. The desktop runtime overlay enables the curated system provider alongside every product-managed private provider and chooses a private default when available, otherwise the first system model.

**Tech Stack:** TypeScript, Effect Schema, SolidJS client data flow, Bun tests, Electron desktop runtime

---

### Task 1: Preserve Provider Model Filters In V2

**Files:**
- Modify: `packages/core/src/config/provider.ts`
- Modify: `packages/core/src/v1/config/migrate.ts`
- Modify: `packages/core/src/config/plugin/provider.ts`
- Test: `packages/core/test/config/config.test.ts`
- Test: `packages/core/test/config/provider.test.ts`

- [ ] **Step 1: Write migration and catalog filtering tests**

Add a migration assertion that V1 `whitelist` and `blacklist` values appear on the V2 provider. Add a provider plugin test that seeds `keep`, `blocked`, and `extra` models and verifies this configuration leaves only `keep`:

```ts
providers: {
  opencode: {
    whitelist: ["keep", "blocked"],
    blacklist: ["blocked"],
  },
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run from `packages/core`:

```bash
bun test test/config/config.test.ts test/config/provider.test.ts
```

Expected: the new assertions fail because V2 provider configuration does not yet retain or apply model filters.

- [ ] **Step 3: Add V2 filter fields and apply them**

Extend `ConfigProvider.Info` with optional string arrays:

```ts
whitelist: Schema.String.pipe(Schema.Array, Schema.optional),
blacklist: Schema.String.pipe(Schema.Array, Schema.optional),
```

Return both fields from `migrateProvider`. In `ConfigProviderPlugin`, inspect the provider record before applying configured model overrides and remove a model when it is absent from a configured whitelist or present in a configured blacklist. Blacklist wins when a model appears in both lists.

- [ ] **Step 4: Run focused tests and typecheck**

Run from `packages/core`:

```bash
bun test test/config/config.test.ts test/config/provider.test.ts
bun typecheck
```

Expected: all focused tests pass and typecheck exits successfully.

### Task 2: Generate The Curated Desktop Runtime Overlay

**Files:**
- Create: `packages/desktop/src/main/model-center/system-models.ts`
- Create: `packages/desktop/src/main/model-center/system-models.test.ts`
- Modify: `packages/desktop/src/main/model-center/runtime-config.ts`
- Modify: `packages/desktop/src/main/model-center/runtime-config.test.ts`

- [ ] **Step 1: Write system model policy tests**

Assert that the policy exports these exact IDs in this order:

```ts
[
  "nemotron-3.5-lightning-free",
  "deepseek-v4-flash-free",
  "laguna-s-2.1-free",
  "hy3-free",
  "nemotron-3-ultra-free",
]
```

Assert that a runtime with no private profiles contains `provider.opencode.whitelist`, enables only `opencode`, and defaults to the first system model. Assert that a private profile with more than five models remains complete and its selected default wins.

- [ ] **Step 2: Run the desktop tests and verify failure**

Run from `packages/desktop`:

```bash
bun test src/main/model-center/system-models.test.ts src/main/model-center/runtime-config.test.ts
```

Expected: tests fail because the system policy and runtime overlay do not exist yet.

- [ ] **Step 3: Implement the fixed system policy**

Export immutable constants from `system-models.ts`:

```ts
export const SYSTEM_PROVIDER_ID = "opencode"
export const SYSTEM_MODEL_IDS = Object.freeze([
  "nemotron-3.5-lightning-free",
  "deepseek-v4-flash-free",
  "laguna-s-2.1-free",
  "hy3-free",
  "nemotron-3-ultra-free",
])
```

Add the `opencode` whitelist entry to `createProductRuntimeConfig`, prepend `opencode` to `enabled_providers`, preserve all serialized private providers, and use `${SYSTEM_PROVIDER_ID}/${SYSTEM_MODEL_IDS[0]}` only when no private model is available. Count both system and private models in the runtime manifest.

- [ ] **Step 4: Run desktop tests and typecheck**

Run from `packages/desktop`:

```bash
bun test src/main/model-center/system-models.test.ts src/main/model-center/runtime-config.test.ts src/main/runtime-environment.test.ts
bun typecheck
```

Expected: all tests pass and typecheck exits successfully.

### Task 3: Verify The Integrated Catalog And Packaged UI

**Files:**
- Modify if assertions require it: `packages/desktop/scripts/package-internal-mac.test.ts`
- Verify: `packages/app/src/components/settings-v2/models.tsx`

- [ ] **Step 1: Run app regression checks**

Run from `packages/app`:

```bash
bun test src/components/settings-v2/model-list-presentation.test.ts
bun typecheck
```

Expected: the existing large-catalog rendering guard remains green.

- [ ] **Step 2: Build the desktop application**

Run from `packages/desktop` with the existing local model snapshot:

```bash
OPENCODE_CHANNEL=beta MODELS_DEV_API_JSON="$HOME/.cache/opencode/models.json" bun run build
```

Expected: the production desktop build completes.

- [ ] **Step 3: Perform a short packaged runtime check**

Launch the built Mac application with isolated user data. Verify the V1 and V2 model endpoints expose exactly five `opencode` models on a clean profile. Seed a private profile containing more than five models and verify every private model remains present.

- [ ] **Step 4: Check model page size and responsiveness**

Open model settings and verify there are five system model switches plus the private model switches, no full public catalog, and no multi-second click delay. Record DOM node count and renderer memory once; do not run a long soak test.

- [ ] **Step 5: Commit the implementation**

```bash
git add packages/core/src/config/provider.ts packages/core/src/v1/config/migrate.ts packages/core/src/config/plugin/provider.ts packages/core/test/config/config.test.ts packages/core/test/config/provider.test.ts packages/desktop/src/main/model-center/system-models.ts packages/desktop/src/main/model-center/system-models.test.ts packages/desktop/src/main/model-center/runtime-config.ts packages/desktop/src/main/model-center/runtime-config.test.ts packages/desktop/scripts/package-internal-mac.test.ts
git commit -m "fix(desktop): curate built-in models"
```

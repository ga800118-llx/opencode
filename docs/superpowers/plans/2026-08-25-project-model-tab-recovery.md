# Project Model And Tab Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every project expose the configured private model catalog deterministically and make restored task tabs display the project identified by their current directory.

**Architecture:** Add a narrow readiness barrier shared by the V2 provider and model handlers so they cannot read the catalog before the configuration-provider plugin finishes its first load. Change the existing session-to-project resolver to prefer normalized directory and sandbox matches, retaining project ID only as a fallback.

**Tech Stack:** TypeScript, Effect, Bun tests, SolidJS.

---

### Task 1: Gate V2 Catalog Reads On Configuration Readiness

**Files:**
- Create: `packages/server/src/handlers/catalog-readiness.ts`
- Create: `packages/server/src/handlers/catalog-readiness.test.ts`
- Modify: `packages/server/src/handlers/provider.ts`
- Modify: `packages/server/src/handlers/model.ts`

- [ ] **Step 1: Write the failing readiness test**

Create a deferred plugin wait and prove that the shared readiness effect requests the configuration-provider plugin and remains pending until that plugin is ready.

```ts
import { expect, test } from "bun:test"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Effect } from "effect"
import { waitForCatalogReady } from "./catalog-readiness"

test("waits for the configuration provider before exposing the catalog", async () => {
  const gate = Promise.withResolvers<void>()
  let requested: PluginV2.ID | undefined
  let settled = false
  const plugins = PluginV2.Service.of({
    add: () => Effect.void,
    remove: () => Effect.void,
    wait: (id) =>
      Effect.sync(() => {
        requested = id
      }).pipe(Effect.andThen(Effect.promise(() => gate.promise))),
  })

  const running = Effect.runPromise(
    waitForCatalogReady.pipe(Effect.provideService(PluginV2.Service, plugins)),
  ).then(() => {
    settled = true
  })

  await Bun.sleep(0)
  expect(requested).toBe(PluginV2.ID.make(ConfigProviderPlugin.Plugin.id))
  expect(settled).toBe(false)

  gate.resolve()
  await running
  expect(settled).toBe(true)
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run from `packages/server`:

```bash
bun test src/handlers/catalog-readiness.test.ts
```

Expected: FAIL because `catalog-readiness.ts` does not exist.

- [ ] **Step 3: Implement the shared readiness effect**

Create `packages/server/src/handlers/catalog-readiness.ts`:

```ts
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Effect } from "effect"

export const waitForCatalogReady = Effect.gen(function* () {
  const plugins = yield* PluginV2.Service
  yield* plugins.wait(PluginV2.ID.make(ConfigProviderPlugin.Plugin.id))
})
```

- [ ] **Step 4: Gate every V2 provider and model read**

Import `waitForCatalogReady` in `provider.ts` and `model.ts`. Run it before reading `Catalog.Service` in `provider.list`, `provider.get`, and `model.list`:

```ts
yield* waitForCatalogReady
const catalog = yield* Catalog.Service
```

Do not change response shapes, catalog filtering, legacy routes, or Sidecar startup behavior.

- [ ] **Step 5: Run the server test and typecheck**

Run from `packages/server`:

```bash
bun test src/handlers/catalog-readiness.test.ts
bun typecheck
```

Expected: the focused test and package typecheck both pass.

- [ ] **Step 6: Commit the catalog fix**

```bash
git add packages/server/src/handlers/catalog-readiness.ts packages/server/src/handlers/catalog-readiness.test.ts packages/server/src/handlers/provider.ts packages/server/src/handlers/model.ts
git commit -m "fix(server): wait for model catalog readiness"
```

### Task 2: Resolve Restored Sessions By Directory First

**Files:**
- Modify: `packages/app/src/pages/layout/helpers.ts`
- Modify: `packages/app/src/pages/layout/helpers.test.ts`

- [ ] **Step 1: Add stale-project-ID regression tests**

Import `projectForSession` in `helpers.test.ts` and add coverage for both directory priority and project-ID fallback:

```ts
test("prefers the session directory over a stale project ID", () => {
  const projects = [
    { id: "default", worktree: "/projects/default" },
    { id: "game", worktree: "/projects/game" },
  ]
  const value = session({ id: "session-game", directory: "/projects/game", projectID: "default" })

  expect(projectForSession(value, projects)).toBe(projects[1])
})

test("falls back to the project ID when the session directory is unknown", () => {
  const projects = [{ id: "default", worktree: "/projects/default" }]
  const value = session({ id: "session-moved", directory: "/projects/moved", projectID: "default" })

  expect(projectForSession(value, projects)).toBe(projects[0])
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/pages/layout/helpers.test.ts
```

Expected: FAIL because the stale project ID currently wins over the matching directory.

- [ ] **Step 3: Change the resolver priority**

Replace the body of `projectForSession` with directory-first resolution:

```ts
export function projectForSession<T extends { id?: string; worktree: string; sandboxes?: string[] }>(
  session: Session,
  projects: T[],
  byID: Map<string, T> = new Map(projects.flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
) {
  const directory = pathKey(session.directory)
  const match = projects.find(
    (project) =>
      pathKey(project.worktree) === directory || project.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
  )
  if (match) return match
  return byID.get(session.projectID)
}
```

Do not change tab rendering, avatar styling, tab persistence, or stored session data.

- [ ] **Step 4: Run the focused test and app typecheck**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/pages/layout/helpers.test.ts
bun typecheck
```

Expected: the focused test and package typecheck both pass.

- [ ] **Step 5: Commit the project-resolution fix**

```bash
git add packages/app/src/pages/layout/helpers.ts packages/app/src/pages/layout/helpers.test.ts
git commit -m "fix(app): resolve task projects by directory"
```

### Task 3: Verify The Scoped Repair

**Files:**
- No additional source files.

- [ ] **Step 1: Run affected regression suites**

Run from `packages/server`:

```bash
bun test src/handlers/catalog-readiness.test.ts
bun typecheck
```

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/pages/layout/helpers.test.ts ./src/hooks/provider-catalog.test.ts ./src/context/global-sync/provider-readiness.test.ts
bun typecheck
bun run build
```

Expected: all tests, typechecks, and the app production build pass.

- [ ] **Step 2: Build the desktop application**

Run from `packages/desktop`:

```bash
bun typecheck
bun run build
```

Expected: desktop typecheck and production build pass. Do not create an installer.

- [ ] **Step 3: Inspect the final diff**

```bash
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
```

Expected: source changes are limited to the two catalog handlers, their shared readiness helper and test, and the layout project resolver and test. Existing unrelated untracked files remain untouched.

- [ ] **Step 4: Open the latest local desktop version for manual verification**

Run the existing desktop development command from `packages/desktop`:

```bash
bun run dev
```

Verify:

- `Default Project` and `game` expose the same configured private model list;
- switching projects does not produce a setup notice when profiles exist;
- restored `game` tabs show the `G` project avatar while Default Project tabs show `D`;
- conversations, elapsed rows, permissions, skills, and file links remain unchanged.

Do not package an installer until this local verification passes.

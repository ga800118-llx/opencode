# Skill Cold-Start Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop Skill management page return and render the installed Skill list correctly on its first cold-start load.

**Architecture:** Load the built-in Skill and config Skill plugins synchronously before the location layer becomes available, while leaving unrelated internal plugins on the existing background fiber. Add a bounded empty-snapshot loader at the Skill settings boundary so compatible older servers and unusual scheduling cannot flash a false empty state.

**Tech Stack:** TypeScript, Effect, SolidJS, TanStack Solid Query, Bun test, Happy DOM

---

## File Structure

- `packages/core/src/plugin/internal.ts`: split Skill-critical plugin startup from background internal plugin startup.
- `packages/core/test/location-layer.test.ts`: verify the first location-scoped management snapshot includes the built-in Skill.
- `packages/app/src/components/settings-v2/skills-controller.ts`: own the bounded empty-snapshot loading policy.
- `packages/app/src/components/settings-v2/skills-controller.test.ts`: test retry count, delays, true empty results, and errors.
- `packages/app/src/components/settings-v2/skills.tsx`: call the bounded loader and suppress the count while pending.
- `packages/app/test-browser/settings-skills.test.ts`: verify the rendered page stays loading across a transient empty response.

### Task 1: Backend Skill Readiness Barrier

**Files:**
- Modify: `packages/core/test/location-layer.test.ts`
- Modify: `packages/core/src/plugin/internal.ts`

- [ ] **Step 1: Write the failing first-snapshot regression test**

Import `SkillV2`, then add this test to the `LocationServiceMap` suite:

```ts
it.live("makes Skill management ready in the first location context", () =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((dir) =>
      Effect.gen(function* () {
        const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
        const managed = yield* SkillV2.Service.use((skill) => skill.management.list()).pipe(
          Effect.scoped,
          Effect.provide(LocationServiceMap.Service.get(location)),
        )

        expect(managed).toContainEqual(
          expect.objectContaining({
            name: "customize-opencode",
            source: { type: "builtin", scope: "global", value: "customize-opencode" },
          }),
        )
      }),
    ),
  ),
)
```

- [ ] **Step 2: Run the test before implementation**

Run from `packages/core`:

```bash
bun test test/location-layer.test.ts --test-name-pattern "makes Skill management ready"
```

Expected: the cold first snapshot fails by omitting `customize-opencode`.

- [ ] **Step 3: Make Skill-critical plugins synchronous**

Replace the single background batch in `packages/core/src/plugin/internal.ts` with:

```ts
yield* State.batch(
  Effect.gen(function* () {
    yield* add(SkillPlugin.Plugin)
    yield* add(ConfigSkillPlugin.Plugin)
  }),
).pipe(Effect.withSpan("PluginInternal.skillBoot"))

yield* State.batch(
  Effect.gen(function* () {
    yield* add(ConfigReferencePlugin.Plugin)
    yield* add(AgentPlugin.Plugin)
    yield* add(CommandPlugin.Plugin)
    yield* add(ModelsDevPlugin)
    yield* add(ConfigAgentPlugin.Plugin)
    yield* add(ConfigCommandPlugin.Plugin)
    for (const item of ProviderPlugins) yield* add(item)
    yield* add(ConfigExternalPlugin.Plugin)
    yield* add(ConfigProviderPlugin.Plugin)
    yield* add(VariantPlugin.Plugin)
  }),
).pipe(Effect.withSpan("PluginInternal.boot"), Effect.forkScoped({ startImmediately: true }))
```

This preserves Skill before ConfigSkill and removes both from the background batch.

- [ ] **Step 4: Verify and commit the backend change**

Run from `packages/core`:

```bash
bun test test/location-layer.test.ts --test-name-pattern "makes Skill management ready"
bun typecheck
```

Expected: the focused test passes and typecheck exits successfully. Then commit only these files:

```bash
git add packages/core/src/plugin/internal.ts packages/core/test/location-layer.test.ts
git commit -m "fix(core): await skill plugin readiness"
```

### Task 2: Bounded Empty-Snapshot Loader

**Files:**
- Modify: `packages/app/src/components/settings-v2/skills-controller.test.ts`
- Modify: `packages/app/src/components/settings-v2/skills-controller.ts`

- [ ] **Step 1: Write controller tests for the loading policy**

Import `loadSkillManagement`, then add these tests:

```ts
test("retries transient empty Skill snapshots with bounded delays", async () => {
  const delays: number[] = []
  let calls = 0
  const result = await loadSkillManagement(
    async () => (++calls === 1 ? [] : [items[0]!]),
    async (milliseconds) => {
      delays.push(milliseconds)
    },
  )
  expect(result).toEqual([items[0]!])
  expect(calls).toBe(2)
  expect(delays).toEqual([100])
})

test("returns a non-empty first Skill snapshot without waiting", async () => {
  const delays: number[] = []
  let calls = 0
  const result = await loadSkillManagement(
    async () => {
      calls++
      return [items[0]!]
    },
    async (milliseconds) => {
      delays.push(milliseconds)
    },
  )
  expect(result).toEqual([items[0]!])
  expect(calls).toBe(1)
  expect(delays).toEqual([])
})

test("accepts an empty Skill snapshot after three attempts", async () => {
  const delays: number[] = []
  let calls = 0
  const result = await loadSkillManagement(
    async () => {
      calls++
      return []
    },
    async (milliseconds) => {
      delays.push(milliseconds)
    },
  )
  expect(result).toEqual([])
  expect(calls).toBe(3)
  expect(delays).toEqual([100, 200])
})

test("does not retry a Skill request error", async () => {
  const failure = new Error("request failed")
  let calls = 0
  const request = loadSkillManagement(async () => {
    calls++
    throw failure
  })
  await expect(request).rejects.toBe(failure)
  expect(calls).toBe(1)
})
```

- [ ] **Step 2: Run the tests before implementation**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/components/settings-v2/skills-controller.test.ts
```

Expected: tests fail because `loadSkillManagement` is not exported.

- [ ] **Step 3: Implement the bounded loader**

Add to `skills-controller.ts`:

```ts
export async function loadSkillManagement(
  list: () => Promise<Skill.ManagementInfo[]>,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
) {
  const delays = [100, 200] as const
  const load = async (attempt: number): Promise<Skill.ManagementInfo[]> => {
    const result = await list()
    if (result.length > 0 || attempt === delays.length) return result
    await wait(delays[attempt]!)
    return load(attempt + 1)
  }
  return load(0)
}
```

- [ ] **Step 4: Verify the controller**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/components/settings-v2/skills-controller.test.ts
```

Expected: all Skill controller tests pass.

### Task 3: Settings Page Integration

**Files:**
- Modify: `packages/app/test-browser/settings-skills.test.ts`
- Modify: `packages/app/src/components/settings-v2/skills.tsx`

- [ ] **Step 1: Write the rendered cold-start regression test**

Add this component test:

```ts
test("keeps a transient empty first response in the loading state", async () => {
  const item = fixture({ id: "cold-start", name: "cold-start" })
  const request = deferred<Skill.ManagementInfo[]>()
  const current = server("scope", [])
  current.behavior.list = async () => (current.listCalls === 1 ? [] : request.promise)
  const view = mount(
    () => "/repo",
    () => current.sdk,
  )

  await waitFor(() => current.listCalls === 2)
  expect(view.host.textContent).toContain("Loading Skills...")
  expect(view.host.textContent).not.toContain("0 installed")
  expect(view.host.textContent).not.toContain("No Skills installed.")

  request.resolve([item])
  await waitFor(() => view.host.textContent?.includes("cold-start") === true)
  expect(view.host.textContent).toContain("1 installed")
})
```

- [ ] **Step 2: Run the browser test before integration**

Run from `packages/app`:

```bash
bun test --conditions=browser --preload ./happydom.ts ./test-browser/settings-skills.test.ts --test-name-pattern "transient empty"
```

Expected: it fails because the first empty array currently renders the empty state.

- [ ] **Step 3: Integrate the loader and hide the pending count**

Import `loadSkillManagement`. Capture the SDK and directory when each query starts:

```ts
queryFn: () => {
  const sdk = serverSDK()
  const directory = props.directory!
  return loadSkillManagement(() => sdk.skillManagement.list(directory))
},
```

Only render the installed count after loading finishes:

```tsx
<Show when={!skills.isPending}>
  <span class="settings-v2-skills-count">{language.t("settings.skills.count", { count: items().length })}</span>
</Show>
```

- [ ] **Step 4: Verify and commit the frontend change**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts ./src/components/settings-v2/skills-controller.test.ts
bun test --conditions=browser --preload ./happydom.ts ./test-browser/settings-skills.test.ts
bun typecheck
```

Expected: controller tests, the full settings browser test file, and app typecheck pass. Then commit:

```bash
git add packages/app/src/components/settings-v2/skills-controller.ts packages/app/src/components/settings-v2/skills-controller.test.ts packages/app/src/components/settings-v2/skills.tsx packages/app/test-browser/settings-skills.test.ts
git commit -m "fix(app): stabilize skill cold start"
```

### Task 4: Desktop Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Restart the source desktop application**

Rebuild the local source backend if required, start the desktop development command, and open `Settings > Skills` once without reloading the renderer.

- [ ] **Step 2: Verify first-open behavior**

- The page may show `正在加载 Skill...` while initialization is in progress.
- It must not show `已安装 0 个` during that interval.
- It must resolve to the installed list, including `agent-browser` and `customize-opencode`.
- Enabling, disabling, source labels, descriptions, and deletion controls must remain available.

- [ ] **Step 3: Confirm repository scope**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: only unrelated pre-existing work remains uncommitted, and the backend and frontend fixes are the latest implementation commits.

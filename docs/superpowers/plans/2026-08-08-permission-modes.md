# Permission Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Restricted, Standard, and Auto approve permission modes to the Guai Code task composer, persist each task's mode, remember a project default, and enforce Restricted mode in the V2 permission evaluator.

**Architecture:** `Permission.Mode` is the shared vocabulary. V2 sessions persist an optional mode column, expose a durable switch operation, and default old rows to Standard at evaluation time. The app remembers project defaults in the existing server-scoped permission store, sends the selected mode during task creation, updates running tasks through the session API, and reuses the existing one-shot permission responder for Auto approve. V1 connections retain the existing auto-accept behavior and do not display the three-mode selector because they cannot enforce Restricted mode.

**Tech Stack:** TypeScript, Effect Schema and services, Drizzle SQLite, Effect HttpApi, generated `@opencode-ai/client`, SolidJS, Kobalte/MenuV2, Bun tests, Storybook, Playwright.

---

## File Map

- `packages/schema/src/permission.ts`: shared `Permission.Mode` schema.
- `packages/schema/src/session.ts`: optional persisted mode on public session info.
- `packages/schema/src/session-event.ts`: durable permission-mode switch event.
- `packages/core/src/session/sql.ts`: nullable `permission_mode` session column.
- `packages/core/src/session/info.ts`: row-to-session mode projection.
- `packages/core/src/session/projector.ts`: project mode-switch events into the session row.
- `packages/core/src/session.ts`: create/inherit/switch mode behavior.
- `packages/core/src/permission.ts`: Restricted overlay and saved-rule precedence.
- `packages/protocol/src/groups/session.ts`: create payload and switch-mode endpoint.
- `packages/server/src/handlers/session.ts`: endpoint handlers.
- `packages/client/src/generated/**`: generated client changes; never edit manually.
- `packages/app/src/context/permission-mode.ts`: pure project-default migration and mode-resolution helpers.
- `packages/app/src/context/permission.tsx`: persisted project defaults, server-confirmed task modes, and Auto approve responses.
- `packages/app/src/product/contracts.ts`, `packages/app/src/product/task-adapter.ts`: carry mode during task creation.
- `packages/app/src/components/prompt-input/submit.ts`: capture the project default when creating a task.
- `packages/app/src/components/permission-mode-control.tsx`: reusable selector and Auto approve confirmation flow.
- `packages/session-ui/src/v2/components/prompt-input/index.tsx`: footer-control slot for app-owned controls.
- `packages/app/src/components/prompt-input-v2.tsx`, `packages/app/src/components/prompt-input.tsx`: render the selector in both composer designs.
- `packages/app/src/pages/session/use-session-commands.tsx`: route the auto-accept command through permission modes.
- `packages/app/src/components/settings-general.tsx`, `packages/app/src/components/settings-v2/general.tsx`, `packages/app/src/components/settings-v2/general-controllers.ts`: keep settings consistent with the selected mode.
- `packages/app/src/i18n/en.ts`, `packages/app/src/i18n/zh.ts`: English and Simplified Chinese copy.

### Task 1: Shared Mode And Session Persistence

**Files:**
- Modify: `packages/schema/src/permission.ts`
- Modify: `packages/schema/src/session.ts`
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/session/info.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/permission.ts`
- Create: generated file under `packages/core/src/database/migration/`
- Modify: `packages/core/schema.json`
- Modify: `packages/core/src/database/migration.gen.ts`
- Modify: `packages/core/src/database/schema.gen.ts`
- Test: `packages/core/test/database-migration.test.ts`

- [ ] **Step 1: Add a failing migration assertion**

Extend the empty-database test to prove that the declared schema includes the new nullable column:

```ts
expect(
  yield* db.get(sql`SELECT name FROM pragma_table_info('session') WHERE name = 'permission_mode'`),
).toEqual({ name: "permission_mode" })
```

- [ ] **Step 2: Run the focused test and verify failure**

Run from `packages/core`:

```bash
bun test test/database-migration.test.ts
```

Expected: FAIL because `session.permission_mode` does not exist.

- [ ] **Step 3: Define the shared mode and durable event**

Add to `packages/schema/src/permission.ts`:

```ts
export const Mode = Schema.Literals(["restricted", "standard", "auto"]).annotate({
  identifier: "Permission.Mode",
})
export type Mode = typeof Mode.Type
```

Export `Mode` from `packages/core/src/permission.ts` beside `Effect`, `Rule`, and `Ruleset`. Add `permissionMode: Permission.Mode.pipe(optional)` to `Session.Info`, importing `Permission` in `packages/schema/src/session.ts`. Add a durable `PermissionModeSwitched` event with `{ ...Base, mode: Permission.Mode }` and include it in `DurableDefinitions` and `Definitions`.

- [ ] **Step 4: Add and project the session column**

Add the Drizzle field and row mapping:

```ts
permission_mode: text().$type<Permission.Mode>(),
```

```ts
permissionMode: row.permission_mode ?? undefined,
```

Project `SessionEvent.PermissionModeSwitched` in `packages/core/src/session/projector.ts`:

```ts
yield* events.project(SessionEvent.PermissionModeSwitched, (event) =>
  db
    .update(SessionTable)
    .set({ permission_mode: event.data.mode, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
    .where(eq(SessionTable.id, event.data.sessionID))
    .run()
    .pipe(Effect.orDie),
)
```

- [ ] **Step 5: Generate the migration and rerun the test**

Run from `packages/core`:

```bash
bun run migration --name add-permission-mode
bun test test/database-migration.test.ts
```

Expected: migration generation creates one TypeScript migration and the test passes.

- [ ] **Step 6: Commit the schema boundary**

```bash
git add packages/schema/src/permission.ts packages/schema/src/session.ts packages/schema/src/session-event.ts packages/core/src/permission.ts packages/core/src/session/sql.ts packages/core/src/session/info.ts packages/core/src/session/projector.ts packages/core/schema.json packages/core/src/database/migration.gen.ts packages/core/src/database/schema.gen.ts packages/core/src/database/migration packages/core/test/database-migration.test.ts
git commit -m "feat(core): persist permission modes"
```

### Task 2: Session Mode Lifecycle And HTTP API

**Files:**
- Modify: `packages/core/src/session.ts`
- Test: `packages/core/test/session-create.test.ts`
- Test: `packages/core/test/session-history.test.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Modify: generated files under `packages/client/src/generated/` and `packages/client/src/generated-effect/`

- [ ] **Step 1: Write failing session lifecycle tests**

Add tests that create an Auto approve parent, create a child without an explicit mode, and switch the child to Restricted:

```ts
const parent = yield* session.create({ location, permissionMode: "auto" })
const child = yield* session.create({ location, parentID: parent.id })
expect(parent.permissionMode).toBe("auto")
expect(child).toMatchObject({ parentID: parent.id, permissionMode: "auto" })

yield* session.switchPermissionMode({ sessionID: child.id, mode: "restricted" })
expect(yield* session.get(child.id)).toMatchObject({ permissionMode: "restricted" })
```

Also assert that switching to the already-selected mode does not append another durable event and that a missing Session returns `Session.NotFoundError`.

- [ ] **Step 2: Run the tests and verify failure**

Run from `packages/core`:

```bash
bun test test/session-create.test.ts test/session-history.test.ts
```

Expected: FAIL because create input, parent inheritance, and `switchPermissionMode` do not exist.

- [ ] **Step 3: Implement the core lifecycle**

Extend create input and the service interface:

```ts
type CreateInput = {
  id?: SessionSchema.ID
  parentID?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  permissionMode?: PermissionV2.Mode
  location: Location.Ref
}

readonly switchPermissionMode: (input: {
  sessionID: SessionSchema.ID
  mode: PermissionV2.Mode
}) => Effect.Effect<void, NotFoundError>
```

During creation, resolve `input.permissionMode`, then the parent mode, then `"standard"`; include `parentID` in the legacy creation record and publish `PermissionModeSwitched` after the created row is projected when the effective mode is not Standard. Leaving the initial Standard mode nullable preserves existing event-history expectations while still resolving old and new default rows to Standard. Implement switching with the same idempotency check used by model switching.

- [ ] **Step 4: Expose the protocol and server handler**

Add `parentID` and `permissionMode` to `session.create`, then add:

```ts
HttpApiEndpoint.post("session.switchPermissionMode", "/api/session/:sessionID/permission-mode", {
  params: { sessionID: Session.ID },
  payload: Schema.Struct({ mode: Permission.Mode }),
  success: HttpApiSchema.NoContent,
  error: SessionNotFoundError,
})
```

The server handler calls `session.switchPermissionMode({ sessionID: ctx.params.sessionID, mode: ctx.payload.mode })` and maps `SessionV2.NotFoundError` like the agent/model handlers.

- [ ] **Step 5: Regenerate the public client**

Run from `packages/client`:

```bash
bun run generate
bun test
bun typecheck
```

Expected: generated Promise and Effect clients include `permissionMode` and `switchPermissionMode`; tests and type checking pass.

- [ ] **Step 6: Rerun core tests and commit**

Run from `packages/core`:

```bash
bun test test/session-create.test.ts test/session-history.test.ts
bun typecheck
```

Expected: PASS.

```bash
git add packages/core/src/session.ts packages/core/test/session-create.test.ts packages/core/test/session-history.test.ts packages/protocol/src/groups/session.ts packages/server/src/handlers/session.ts packages/client/src/generated packages/client/src/generated-effect
git commit -m "feat(server): expose session permission modes"
```

### Task 3: Enforce Restricted Mode In Permission Evaluation

**Files:**
- Modify: `packages/core/src/permission.ts`
- Test: `packages/core/test/permission.test.ts`

- [ ] **Step 1: Write failing Restricted-mode tests**

Set the fixture session's `permission_mode` to `restricted`, configure broad allows, and prove mutation requests still ask while reads remain configured:

```ts
yield* db.update(SessionTable).set({ permission_mode: "restricted" }).where(eq(SessionTable.id, sessionID)).run()
yield* setRules([{ action: "*", resource: "*", effect: "allow" }])

expect(yield* service.ask(assertion({ action: "read" }))).toMatchObject({ effect: "allow" })
expect(yield* service.ask(assertion({ action: "edit" }))).toMatchObject({ effect: "ask" })
expect(yield* service.ask(assertion({ action: "bash" }))).toMatchObject({ effect: "ask" })
expect(yield* service.ask(assertion({ action: "external_directory" }))).toMatchObject({ effect: "ask" })
```

Add separate assertions that a configured deny remains denied and a saved edit allow is ignored in Restricted mode without being removed from `PermissionSaved`.

- [ ] **Step 2: Run the test and verify failure**

Run from `packages/core`:

```bash
bun test test/permission.test.ts
```

Expected: mutation actions resolve to allow because no mode overlay exists.

- [ ] **Step 3: Add the fixed Restricted overlay**

Keep configured-deny evaluation first, append saved allows second, and append the mode overlay last:

```ts
const restricted: Permission.Ruleset = ["edit", "bash", "external_directory"].map((action) => ({
  action,
  resource: "*",
  effect: "ask" as const,
}))

const all = [...rules, ...(yield* savedRules()), ...(session.permissionMode === "restricted" ? restricted : [])]
```

Standard and Auto add no rules. Auto can never receive a request for a configured denial, so the client auto-responder cannot override it.

- [ ] **Step 4: Run tests, typecheck, and commit**

Run from `packages/core`:

```bash
bun test test/permission.test.ts
bun typecheck
```

Expected: PASS.

```bash
git add packages/core/src/permission.ts packages/core/test/permission.test.ts
git commit -m "feat(core): enforce restricted permissions"
```

### Task 4: Project Defaults And Auto Approve State

**Files:**
- Create: `packages/app/src/context/permission-mode.ts`
- Create: `packages/app/src/context/permission-mode.test.ts`
- Modify: `packages/app/src/context/permission.tsx`
- Modify: `packages/app/src/context/permission-auto-respond.ts`
- Modify: `packages/app/src/context/permission-auto-respond.test.ts`
- Modify: `packages/app/src/utils/session.ts`
- Modify: `packages/app/src/product/contracts.ts`
- Modify: `packages/app/src/product/task-adapter.ts`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Test: `packages/app/src/components/prompt-input/submit.test.ts`

- [ ] **Step 1: Write failing pure-state tests**

Test project isolation, default Standard, legacy directory migration, and existing-task precedence:

```ts
expect(projectPermissionMode({}, "/project")).toBe("standard")
expect(projectPermissionMode({ [directoryAcceptKey("/project")]: "auto" }, "/project")).toBe("auto")
expect(migratePermissionModes({ [directoryAcceptKey("/project")]: true })).toEqual({
  [directoryAcceptKey("/project")]: "auto",
})
expect(taskPermissionMode("restricted", "auto")).toBe("restricted")
expect(taskPermissionMode(undefined, "auto")).toBe("standard")
```

Extend auto-response tests so a V2 task in Auto mode responds through its parent lineage, while Standard and Restricted do not.

- [ ] **Step 2: Run app unit tests and verify failure**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/context/permission-mode.test.ts src/context/permission-auto-respond.test.ts
```

Expected: FAIL because the mode helpers do not exist.

- [ ] **Step 3: Implement persisted project defaults and task modes**

Extend the permission store to:

```ts
  persisted(
    Persist.serverGlobal(input.sdk.scope, "permission", ["permission.v4"]),
    createStore({
      autoAccept: {} as Record<string, boolean>,
      mode: {} as Record<string, Permission.Mode>,
      autoConfirmed: {} as Record<string, boolean>,
    }),
  )
  const [runtime, setRuntime] = createStore({ taskMode: {} as Record<string, Permission.Mode> })
```

Persist `autoAccept`, `mode`, and `autoConfirmed`; keep `taskMode` in the separate transient store. For V2, resolve a task's mode from the transient server-confirmed map, then normalized session info, then Standard. For a draft, use the directory project default. `setMode` saves the project default, calls `api.session.switchPermissionMode` for an existing task, and only updates `taskMode` after success. When mode becomes Auto, process pending requests with the existing duplicate-response guard.

- [ ] **Step 4: Carry the mode into task creation**

Add `permissionMode: Permission.Mode` to `ProductCreateTaskInput`, pass it to `api.session.create`, and supply it from the prompt submit path:

```ts
const permissionMode = permission.projectMode(sessionDirectory)
await taskAdapter().create({
  directory: sessionDirectory,
  agent: currentAgent.name,
  model: { modelID: currentModel.id, providerID: currentModel.provider.id, variant },
  permissionMode,
})
```

Preserve `permissionMode` in `normalizeSessionInfo` with a local normalized-session intersection type. The V1 compatibility adapter ignores the extra create field and returns sessions without a mode.

- [ ] **Step 5: Test submission and commit**

Add a prompt-submit assertion that a draft created with an Auto project default sends `permissionMode: "auto"` and does not need the old post-create auto-accept race.

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/context/permission-mode.test.ts src/context/permission-auto-respond.test.ts src/components/prompt-input/submit.test.ts
bun typecheck
```

Expected: PASS.

```bash
git add packages/app/src/context/permission-mode.ts packages/app/src/context/permission-mode.test.ts packages/app/src/context/permission.tsx packages/app/src/context/permission-auto-respond.ts packages/app/src/context/permission-auto-respond.test.ts packages/app/src/utils/session.ts packages/app/src/product/contracts.ts packages/app/src/product/task-adapter.ts packages/app/src/components/prompt-input/submit.ts packages/app/src/components/prompt-input/submit.test.ts
git commit -m "feat(app): manage project permission modes"
```

### Task 5: Composer Selector And Risk Confirmation

**Files:**
- Create: `packages/app/src/components/permission-mode-control.tsx`
- Create: `packages/app/src/components/permission-mode-control.test.ts`
- Modify: `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- Modify: `packages/session-ui/src/v2/components/prompt-input/prompt-input.stories.tsx`
- Modify: `packages/ui/src/v2/components/icon.tsx`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input.stories.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [ ] **Step 1: Write failing mode-request behavior tests**

Export the confirmation decision as a small async controller and test it without UI framework mocks:

```ts
expect(
  await requestPermissionMode({ mode: "restricted", confirmed: false, confirm, markConfirmed, setMode }),
).toBe(true)
expect(confirm).not.toHaveBeenCalled()
expect(setMode).toHaveBeenCalledWith("restricted")

expect(
  await requestPermissionMode({ mode: "auto", confirmed: false, confirm: cancel, markConfirmed, setMode }),
).toBe(false)
expect(setMode).not.toHaveBeenCalledWith("auto")

expect(
  await requestPermissionMode({ mode: "auto", confirmed: false, confirm: approve, markConfirmed, setMode }),
).toBe(true)
expect(markConfirmed).toHaveBeenCalled()
expect(setMode).toHaveBeenCalledWith("auto")
```

The browser verification later proves that the control renders nothing for V1 and restores composer focus after selection or dialog dismissal.

- [ ] **Step 2: Run the focused component test and verify failure**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/permission-mode-control.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add the app-owned footer control**

Add an optional `footerControl?: JSX.Element` prop to `PromptInputV2` and render it after the variant control. Keep policy logic out of `session-ui`.

Build `PermissionModeControl` with `MenuV2`, a shield icon, radio items, one-line labels, and short descriptions. Use the current session ID when present and the project default for a draft. Auto mode opens a `Dialog`/`DialogV2` confirmation whose cancel/overlay/Escape path resolves false and whose confirm path records `autoConfirmed` before setting the mode.

- [ ] **Step 4: Render in both composer designs**

Expose `sessionID: () => props.controls.session.id` on `PromptInputV2ComposerController`, then pass the control through `PromptInputV2Composer`:

```tsx
footerControl={<PermissionModeControl sessionID={props.controller.sessionID()} onClose={props.controller.restoreFocus} />}
```

Add the same app-owned control to the legacy composer tray, guarded by `sdk().protocolKind() === "v2"`. Do not expose it on V1.

- [ ] **Step 5: Add copy, icon, and stories**

Add English and Simplified Chinese keys for all labels, descriptions, confirmation text, cancel, and confirm actions. Add a V2 `shield` icon matching the existing 16px icon style. Extend stories with Standard and open-menu examples at 760px and 390px widths.

- [ ] **Step 6: Test, typecheck, and commit**

Run from `packages/session-ui` and `packages/app`:

```bash
bun typecheck
```

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/permission-mode-control.test.ts src/components/prompt-input-v2-copy.test.ts
bun typecheck
```

Expected: PASS.

```bash
git add packages/app/src/components/permission-mode-control.tsx packages/app/src/components/permission-mode-control.test.ts packages/session-ui/src/v2/components/prompt-input/index.tsx packages/session-ui/src/v2/components/prompt-input/prompt-input.stories.tsx packages/ui/src/v2/components/icon.tsx packages/app/src/components/prompt-input-v2.tsx packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input.stories.tsx packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): add composer permission selector"
```

### Task 6: Unify Command And Settings Entry Points

**Files:**
- Modify: `packages/app/src/pages/session/use-session-commands.tsx`
- Modify: `packages/app/src/components/settings-general.tsx`
- Modify: `packages/app/src/components/settings-v2/general.tsx`
- Modify: `packages/app/src/components/settings-v2/general-controllers.ts`
- Test: `packages/app/src/components/settings-v2/general-controllers.test.ts`

- [ ] **Step 1: Add failing controller tests**

Extract the mode-to-auto-toggle transition as a pure function and prove Restricted and Standard both enable Auto, while disabling Auto returns to Standard:

```ts
expect(toggleAutoMode("restricted")).toBe("auto")
expect(toggleAutoMode("standard")).toBe("auto")
expect(toggleAutoMode("auto")).toBe("standard")
```

- [ ] **Step 2: Run the test and verify failure**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2/general-controllers.test.ts
```

Expected: FAIL because mode transitions are not yet shared.

- [ ] **Step 3: Route old entry points through mode state**

For V2, the command palette and settings switch read `permission.mode(sessionID, directory)` and request `toggleAutoMode(current)`. Auto selection must use the same confirmation flow as the composer. For V1, retain `enableAutoAccept`/`disableAutoAccept` unchanged.

Keep the existing settings switch rather than introducing a second granular editor: checked means Auto, unchecked means Standard or Restricted. Turning it off always selects Standard, while the composer remains the place to choose Restricted explicitly.

- [ ] **Step 4: Run app tests, typecheck, and commit**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2/general-controllers.test.ts src/context/permission-auto-respond.test.ts
bun typecheck
```

Expected: PASS.

```bash
git add packages/app/src/pages/session/use-session-commands.tsx packages/app/src/components/settings-general.tsx packages/app/src/components/settings-v2/general.tsx packages/app/src/components/settings-v2/general-controllers.ts packages/app/src/components/settings-v2/general-controllers.test.ts
git commit -m "refactor(app): unify permission mode controls"
```

### Task 7: End-To-End Verification And Completion Audit

**Files:**
- Modify only if verification finds a defect.
- Update: `docs/superpowers/plans/2026-08-08-permission-modes.md` checkbox state.

- [ ] **Step 1: Run generated-artifact checks**

Run from `packages/core`:

```bash
bun run migration --check
bun typecheck
```

Run from `packages/client`:

```bash
bun run check:generated
bun typecheck
```

Expected: all commands exit 0 and generated files are clean.

- [ ] **Step 2: Run focused package tests**

Run from `packages/core`:

```bash
bun test test/database-migration.test.ts test/session-create.test.ts test/session-history.test.ts test/permission.test.ts
```

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/context/permission-mode.test.ts src/context/permission-auto-respond.test.ts src/components/prompt-input/submit.test.ts src/components/permission-mode-control.test.ts src/components/settings-v2/general-controllers.test.ts
bun typecheck
```

Expected: all focused tests and type checks pass.

- [ ] **Step 3: Start the real UI**

Start Storybook from the repository root:

```bash
bun run dev:storybook -- --host 127.0.0.1 --port 6006
```

Expected: Storybook reports `http://127.0.0.1:6006` without build errors.

- [ ] **Step 4: Verify desktop and mobile interaction**

Using Playwright or `agent-browser`, inspect the real composer story at 1440x900 and 390x844. Verify:

- the shield and mode label fit without overlapping model, variant, or submit controls;
- all three menu items are visible and keyboard-selectable;
- descriptions wrap without clipping at mobile width;
- Restricted and Standard switch immediately;
- Auto approve opens the warning once, cancel preserves the previous mode, and confirm selects Auto;
- closing the menu or warning returns focus to the composer;
- V1 stories do not render the selector.

Save screenshots under `docs/product/phase-3/artifacts/permission-modes-desktop.png` and `docs/product/phase-3/artifacts/permission-modes-mobile.png` only if this repository's existing verification convention requires checked-in artifacts.

- [ ] **Step 5: Audit every specification requirement**

Read `docs/superpowers/specs/2026-08-08-permission-modes-design.md` line by line and map each requirement to one of: schema/API evidence, core test evidence, app test evidence, or browser evidence. Fix every missing or contradictory item before claiming completion. Confirm `SECURITY.md` remains accurate and no copy calls Auto approve a sandbox or Full system access.

- [ ] **Step 6: Commit verification fixes or close cleanly**

If verification changed files:

```bash
git add packages/schema/src/permission.ts packages/schema/src/session.ts packages/schema/src/session-event.ts packages/core/src/session packages/core/src/permission.ts packages/core/test/database-migration.test.ts packages/core/test/session-create.test.ts packages/core/test/session-history.test.ts packages/core/test/permission.test.ts packages/protocol/src/groups/session.ts packages/server/src/handlers/session.ts packages/client/src/generated packages/client/src/generated-effect packages/app/src/context/permission-mode.ts packages/app/src/context/permission-mode.test.ts packages/app/src/context/permission.tsx packages/app/src/context/permission-auto-respond.ts packages/app/src/context/permission-auto-respond.test.ts packages/app/src/utils/session.ts packages/app/src/product/contracts.ts packages/app/src/product/task-adapter.ts packages/app/src/components/prompt-input packages/app/src/components/prompt-input-v2.tsx packages/app/src/components/prompt-input.tsx packages/app/src/components/permission-mode-control.tsx packages/app/src/components/permission-mode-control.test.ts packages/app/src/pages/session/use-session-commands.tsx packages/app/src/components/settings-general.tsx packages/app/src/components/settings-v2/general.tsx packages/app/src/components/settings-v2/general-controllers.ts packages/app/src/components/settings-v2/general-controllers.test.ts packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts packages/session-ui/src/v2/components/prompt-input packages/ui/src/v2/components/icon.tsx
git commit -m "test(app): verify permission modes"
```

Then confirm `git status --short` contains only pre-existing unrelated work before reporting completion.

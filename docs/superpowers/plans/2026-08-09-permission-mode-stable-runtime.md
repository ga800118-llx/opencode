# Stable Runtime Permission Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Restricted, Standard, and Auto approve available on the stable desktop runtime while preserving private models, projects, history, tool calls, run locations, presentation modes, and timeline behavior.

**Architecture:** Keep the desktop app on the stable V1-compatible transport and add permission mode as an optional stable session field plus a dedicated stable switch endpoint. The stable permission service enforces Restricted mode server-side, while the app detects support from the active server's OpenAPI document and uses the compatibility adapter for create, read, and switch operations. Older servers remain usable and show a disabled upgrade state instead of silently hiding the control.

**Tech Stack:** TypeScript, Effect Schema and services, Drizzle SQLite, Effect HttpApi, generated legacy JavaScript SDK, SolidJS, Bun tests, Electron.

---

## File Map

- `packages/opencode/src/session/session.ts`: stable session schema, persistence mapping, creation, inheritance, fork behavior, and switching.
- `packages/opencode/src/permission/index.ts`: stable Restricted evaluation and pending-request re-evaluation.
- `packages/opencode/src/session/tools.ts`: pass the current task's mode into every tool permission assertion.
- `packages/opencode/src/tool/task.ts`: preserve the parent mode when creating a child task.
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`: stable public endpoint contract.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`: stable endpoint handler.
- `packages/sdk/js/src/generated/**`: regenerated legacy SDK; never edit manually.
- `packages/app/src/utils/server-protocol.ts`: protocol-specific capability probing without changing protocol selection.
- `packages/app/src/utils/server-compat.ts`: stable session normalization, creation, and mode switching.
- `packages/app/src/context/permission.tsx`: capability state and stable/V2 mode behavior.
- `packages/app/src/components/permission-mode-control.tsx`: enabled selector and visible unsupported state.
- `packages/app/src/i18n/en.ts`, `packages/app/src/i18n/zh.ts`: unsupported-server copy.

### Task 1: Stable Session Mode Lifecycle

**Files:**
- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/src/tool/task.ts`
- Test: `packages/opencode/test/session/session.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Add focused tests which create a root task with `permissionMode: "auto"`, read it back, create a child, fork the task, and switch the root:

```ts
const parent = yield* session.create({ title: "mode-parent", permissionMode: "auto" })
expect((yield* session.get(parent.id)).permissionMode).toBe("auto")

const child = yield* session.create({ parentID: parent.id, permissionMode: parent.permissionMode })
expect(child.permissionMode).toBe("auto")

const fork = yield* session.fork({ sessionID: parent.id })
expect(fork.permissionMode).toBe("auto")

yield* session.setPermissionMode({ sessionID: parent.id, mode: "restricted" })
expect((yield* session.get(parent.id)).permissionMode).toBe("restricted")
```

Also assert that a newly created session without a mode keeps `permissionMode` undefined, which resolves to Standard in the application and avoids rewriting old rows.

- [ ] **Step 2: Run the lifecycle tests and verify failure**

Run from `packages/opencode`:

```bash
bun test test/session/session.test.ts
```

Expected: FAIL because stable `Session.Info`, creation, and `setPermissionMode` do not yet expose the mode.

- [ ] **Step 3: Add the stable session field and service operation**

Import the shared schema namespace and add the optional field to `Info`, `CreateInput`, `Interface.create`, and `createNext`:

```ts
import { Permission as PermissionSchema } from "@opencode-ai/schema/permission"

permissionMode: optional(PermissionSchema.Mode),
```

Map `row.permission_mode` in `fromRow`, map `info.permissionMode` in `toRow`, copy it into the create result and fork result, and add:

```ts
readonly setPermissionMode: (input: {
  sessionID: SessionID
  mode: PermissionSchema.Mode
}) => Effect.Effect<void>
```

Implement it through the existing `patch` path so the normal `session.updated` projection writes `permission_mode` and refreshes `time.updated`.

- [ ] **Step 4: Make child task creation inherit the parent mode**

In `packages/opencode/src/tool/task.ts`, pass the loaded parent's mode when a new child is created:

```ts
permissionMode: parent.permissionMode,
```

Resumed child tasks keep their stored value.

- [ ] **Step 5: Run tests and type checking**

Run from `packages/opencode`:

```bash
bun test test/session/session.test.ts test/permission-task.test.ts
bun typecheck
```

Expected: PASS.

### Task 2: Stable Restricted Enforcement

**Files:**
- Modify: `packages/opencode/src/permission/index.ts`
- Modify: `packages/opencode/src/session/tools.ts`
- Test: `packages/opencode/test/permission/next.test.ts`

- [ ] **Step 1: Write failing evaluator and pending-request tests**

Add cases proving:

```ts
expect(Permission.evaluateMode("edit", "*", "restricted", configured, approved).action).toBe("ask")
expect(Permission.evaluateMode("bash", "git status", "restricted", configured, approved).action).toBe("ask")
expect(Permission.evaluateMode("external_directory", "/tmp", "restricted", configured, approved).action).toBe("ask")
expect(Permission.evaluateMode("read", "src/app.ts", "restricted", configured, approved).action).toBe("allow")
expect(Permission.evaluateMode("edit", "secret", "restricted", denied, approved).action).toBe("deny")
```

Add an Effect test with two pending Restricted edit requests: replying `always` to the first must leave the second pending.

- [ ] **Step 2: Run the permission tests and verify failure**

Run from `packages/opencode`:

```bash
bun test test/permission/next.test.ts
```

Expected: FAIL because stable permission requests do not carry a mode and remembered allows override everything.

- [ ] **Step 3: Implement mode-aware evaluation**

Define a stable ask input extending the existing V1 request with an optional mode. Evaluate configured rules first so a matching deny remains final. For Restricted mode and `edit`, `bash`, or `external_directory`, return `ask`; otherwise evaluate configured plus remembered rules as today.

Store `mode` and a copied `ruleset` in each `PendingEntry`. During an `always` reply, re-evaluate every pending request through the same mode-aware function instead of testing only the remembered allow list.

- [ ] **Step 4: Pass session mode into tool permission assertions**

In `packages/opencode/src/session/tools.ts` add:

```ts
mode: input.session.permissionMode,
```

The shared `Tool.Context.ask` input stays unchanged because the session layer, not individual tools, supplies this server-owned value.

- [ ] **Step 5: Run focused tests and type checking**

Run from `packages/opencode`:

```bash
bun test test/permission/next.test.ts test/permission-task.test.ts
bun typecheck
```

Expected: PASS.

### Task 3: Stable HTTP Endpoint And Legacy SDK

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Test: `packages/opencode/test/server/httpapi-session.test.ts`
- Regenerate: `packages/sdk/js/src/generated/**`

- [ ] **Step 1: Write a failing HTTP integration test**

Create a session, post the stable mode payload, and read it back:

```ts
const switched = yield* request(`/session/${created.id}/permission-mode`, {
  method: "POST",
  body: JSON.stringify({ mode: "restricted" }),
})
expect(switched.status).toBe(200)
expect(yield* responseJson(switched)).toMatchObject({ id: created.id, permissionMode: "restricted" })
```

Also assert `400` for an invalid mode and `404` for a missing session.

- [ ] **Step 2: Run the HTTP test and verify failure**

Run from `packages/opencode`:

```bash
bun test test/server/httpapi-session.test.ts
```

Expected: FAIL with a missing route.

- [ ] **Step 3: Add the public stable endpoint**

Add the path and payload:

```ts
export const PermissionModePayload = Schema.Struct({ mode: PermissionSchema.Mode })
permissionMode: `${root}/:sessionID/permission-mode`,
```

Register a POST endpoint named `switchPermissionMode`, with operation identifier `session.switchPermissionMode`, `WorkspaceRoutingQuery`, `Session.Info` success, and the normal bad-request/not-found errors.

- [ ] **Step 4: Implement and register the handler**

The handler must require the session, call `session.setPermissionMode`, and return the refreshed stable session:

```ts
const switchPermissionMode = Effect.fn("SessionHttpApi.switchPermissionMode")(function* (ctx) {
  yield* requireSession(ctx.params.sessionID)
  yield* session.setPermissionMode({ sessionID: ctx.params.sessionID, mode: ctx.payload.mode })
  return yield* requireSession(ctx.params.sessionID)
})
```

Register it in the group handler chain.

- [ ] **Step 5: Regenerate the legacy JavaScript SDK**

Run from the repository root:

```bash
./packages/sdk/js/script/build.ts
```

Expected: generated session types contain `permissionMode`, create accepts it, and `session.switchPermissionMode` calls the stable endpoint.

- [ ] **Step 6: Verify the server and SDK**

Run:

```bash
cd packages/opencode && bun test test/server/httpapi-session.test.ts && bun typecheck
cd ../sdk/js && bun typecheck
```

Expected: PASS.

### Task 4: Desktop Stable Compatibility And Capability Detection

**Files:**
- Modify: `packages/app/src/utils/server-protocol.ts`
- Test: `packages/app/src/utils/server-protocol.test.ts`
- Modify: `packages/app/src/utils/server-compat.ts`
- Test: `packages/app/src/utils/server-compat.test.ts`

- [ ] **Step 1: Write failing capability tests**

Add a V1 OpenAPI document containing:

```ts
paths: {
  "/session/{sessionID}/permission-mode": {
    post: { operationId: "session.switchPermissionMode" },
  },
}
```

Assert that V1 probes `/doc`, V2 probes `/openapi.json`, both recognize their own POST route, and neither changes `detectServerProtocol` behavior. A V1 document without the route must return false.

- [ ] **Step 2: Implement protocol-specific probing**

Keep legacy-first protocol detection. Update `hasPermissionModeCapability` to accept the expected stable or V2 route and update `detectPermissionModeCapability` to probe `/doc` for V1 and `/openapi.json` for V2 using the same authenticated request helper.

- [ ] **Step 3: Write failing compatibility adapter tests**

Assert that stable list/get maps `permissionMode`, stable create forwards it, and stable switching invokes the generated legacy method with `sessionID`, `mode`, and directory.

- [ ] **Step 4: Implement stable mapping and switching**

Add `permissionMode: session.permissionMode` to `sessionInfo`, forward the create field, and add `switchPermissionMode` to the V1 session adapter. Return normalized session information so the permission context can refresh from server-confirmed state.

- [ ] **Step 5: Run focused app utility tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/utils/server-protocol.test.ts src/utils/server-compat.test.ts
```

Expected: PASS.

### Task 5: Capability State And Unsupported UI

**Files:**
- Modify: `packages/app/src/context/permission.tsx`
- Test: `packages/app/src/context/permission-mode.test.ts`
- Modify: `packages/app/src/components/permission-mode-control.tsx`
- Test: `packages/app/src/components/permission-mode-control.test.ts`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [ ] **Step 1: Write failing context tests for capable and old V1 servers**

For a capable V1 harness, assert `supportsModesAsync()` resolves true and `setMode` calls the compatibility API. For an old V1 harness, assert it resolves false and keeps the legacy auto-accept path.

- [ ] **Step 2: Remove the V2-only capability gate**

Initialize capability from `sdk.supportsPermissionModes()` when known, then resolve `sdk.permissionModeCapability` for either transport. `supportsModes()` returns the resolved capability without checking `protocolKind()`.

Expose a tri-state status for the control:

```ts
modeCapability(): boolean | undefined
```

`undefined` means probing, `true` means enabled, and `false` means the connected server needs an upgrade.

- [ ] **Step 3: Write failing control tests**

Assert that supported mode renders the three choices; unsupported mode renders a disabled shield control with upgrade copy; and probing mode retains a stable control width without enabling interaction.

- [ ] **Step 4: Implement the visible unsupported state**

Render `PermissionModeControl` whenever the composer is in normal prompt mode. When capability is false, disable the trigger and expose `permission.mode.unsupported.description`; when undefined, disable it with loading semantics. Do not label an unsupported server as Standard because it cannot enforce all three modes.

Add copy:

```ts
"permission.mode.unsupported.label": "Permission unavailable",
"permission.mode.unsupported.description": "Upgrade the connected computer to use permission modes.",
```

and the equivalent Simplified Chinese strings.

- [ ] **Step 5: Run focused state and UI tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/context/permission-mode.test.ts src/components/permission-mode-control.test.ts src/components/prompt-input/submit.test.ts
bun typecheck
```

Expected: PASS.

### Task 6: Full Regression And Packaged Mac Smoke Test

**Files:**
- Verify all task files above.
- Build output: `packages/desktop/dist/mac-arm64/Agent Desktop Dev.app`

- [ ] **Step 1: Run affected package checks**

Run type checking from each package, never the repository root:

```bash
cd packages/schema && bun typecheck
cd ../core && bun typecheck
cd ../opencode && bun typecheck
cd ../sdk/js && bun typecheck
cd ../../app && bun typecheck
cd ../desktop && bun typecheck
```

Expected: PASS, or record any pre-existing unrelated failure separately.

- [ ] **Step 2: Run the focused regression suite**

Run stable session, permission, HTTP, protocol, adapter, context, control, submission, run-location, and timeline tests. Run app tests with Solid conditions and `happydom.ts`.

Expected: all focused tests PASS.

- [ ] **Step 3: Build the desktop application**

Run from `packages/desktop`:

```bash
./node_modules/.bin/electron-vite build
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dir --config electron-builder.config.ts
```

Expected: `dist/mac-arm64/Agent Desktop Dev.app` is produced without signing or notarization.

- [ ] **Step 4: Smoke test the packaged application with the existing profile**

Verify in one packaged build:

1. The private model `deepseek-v4-pro` remains visible and selectable.
2. The permission selector appears before a new task and shows Restricted, Standard, and Auto approve.
3. Switching a real task persists after task refresh.
4. Projects and existing history remain visible.
5. Simple/Advanced presentation, run location, and assistant-process folding remain available.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated existing worktree changes remain untouched and are listed separately from this feature's files.

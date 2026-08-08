# Skill Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete location-aware Skill manager to GUaI Code settings that lists every installation and safely enables, disables, and deletes supported local Skills.

**Architecture:** Extend the Skill schema with source ownership and management response contracts, then make `SkillV2.Service` maintain separate installed and effective views. Persist disabled installation IDs under `Global.state`, protect writes with the existing filesystem lock service, and move deletions into a recovery directory. Expose location-scoped management endpoints through Protocol and Server, regenerate the public Client, and add a dense V2 settings tab backed by a narrow authenticated protocol adapter and pure filtering helpers.

**Tech Stack:** TypeScript, Effect 4, Effect HttpApi, Bun tests, SolidJS, TanStack Solid Query, GUaI Code V2 UI components, generated Promise/Effect clients.

---

## File Map

- Modify `packages/schema/src/skill.ts`: public source metadata, management IDs, rows, mutation input, and deletion reason schemas.
- Modify `packages/core/src/skill.ts`: installed-entry loading, effective-list resolution, and management service methods.
- Create `packages/core/src/skill/management.ts`: stable identities, management-state persistence, duplicate resolution, and recovery deletion helpers.
- Modify `packages/core/src/config/plugin/skill.ts`: authoritative scope and ownership metadata for config-discovered sources.
- Modify `packages/core/src/plugin/skill.ts`: built-in origin metadata.
- Modify `packages/core/test/config/skill.test.ts`: source-origin contract tests.
- Modify `packages/core/test/skill.test.ts`: duplicate, persistence, enable/disable, and deletion tests.
- Modify `packages/protocol/src/groups/skill.ts`: list, patch, and delete management endpoints and HTTP error schemas.
- Modify `packages/server/src/handlers/skill.ts`: map core management operations and errors to Protocol responses.
- Modify `packages/client/src/contract.ts`: assign stable public method names to the new endpoint identifiers.
- Regenerate `packages/client/src/generated/**` and `packages/client/src/generated-effect/**` with the repository generator.
- Create `packages/app/src/components/settings-v2/skills-controller.ts`: pure filtering, grouping, source labels, and mutation-state helpers.
- Create `packages/app/src/components/settings-v2/skills-controller.test.ts`: controller and presentation tests.
- Create `packages/app/src/components/settings-v2/skills.tsx`: query, rows, switches, confirmation dialog, and mutation feedback.
- Modify `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`: register the Skills tab and pass the active directory.
- Modify `packages/app/src/components/settings-v2/settings-v2.css`: stable responsive Skill list layout.
- Modify `packages/app/src/context/server-sdk.tsx`: expose an authenticated Skill management adapter alongside the pinned compatibility client.
- Create `packages/app/src/utils/skill-management-api.ts`: narrowly typed HTTP adapter for management routes.
- Create `packages/app/src/utils/skill-management-api.test.ts`: URL, method, payload, response, and error tests for the adapter.
- Modify all `packages/app/src/i18n/*.ts` dictionaries: maintain parity; provide native English, Simplified Chinese, and Traditional Chinese copy and English fallback copy elsewhere.
- Modify `packages/app/src/i18n/parity.test.ts`: no behavior change; use it as the dictionary parity gate.

### Task 1: Define Skill Management Contracts

**Files:**
- Modify: `packages/schema/src/skill.ts`
- Test: `packages/core/test/skill.test.ts`

- [ ] **Step 1: Write the failing source-metadata assertions**

Update `packages/core/test/skill.test.ts` so a directly registered source retains
schema-validated origin metadata:

```ts
yield* skill.transform((editor) =>
  editor.source(
  SkillV2.DirectorySource.make({
    type: "directory",
    path: AbsolutePath.make("/repo/.opencode/skills"),
    origin: {
      scope: "project",
      type: "config-directory",
      value: "/repo/.opencode",
    },
  }),
  ),
)
expect(yield* skill.sources()).toContainEqual({
  type: "directory",
  path: AbsolutePath.make("/repo/.opencode/skills"),
  origin: { scope: "project", type: "config-directory", value: "/repo/.opencode" },
})
```

- [ ] **Step 2: Run the focused test and verify the contract is missing**

Run from `packages/core`:

```bash
bun test test/skill.test.ts
```

Expected: FAIL at type checking or schema construction because
`DirectorySource` does not accept `origin`.

- [ ] **Step 3: Add the management schemas**

Extend `packages/schema/src/skill.ts` with these public contracts, and add optional `origin` to all three source variants:

```ts
export const Scope = Schema.Literals(["global", "project"]).annotate({ identifier: "SkillV2.Scope" })
export type Scope = typeof Scope.Type

export const SourceOrigin = Schema.Struct({
  scope: Scope,
  type: Schema.Literals(["builtin", "config-directory", "config-file", "plugin"]),
  value: Schema.String.pipe(optional),
}).annotate({ identifier: "SkillV2.SourceOrigin" })
export interface SourceOrigin extends Schema.Schema.Type<typeof SourceOrigin> {}

export const ManagementID = Schema.String.pipe(Schema.brand("SkillV2.ManagementID"))
export type ManagementID = typeof ManagementID.Type

export const ManagementStatus = Schema.Literals(["active", "shadowed", "disabled"])
export const DeleteBlocked = Schema.Literals(["builtin", "remote", "plugin", "unsafe"])

export const ManagementSource = Schema.Struct({
  type: Schema.Literals(["builtin", "directory", "url", "plugin"]),
  scope: Scope,
  value: Schema.String,
}).annotate({ identifier: "SkillV2.ManagementSource" })

export const ManagementInfo = Schema.Struct({
  id: ManagementID,
  name: Schema.String,
  description: Schema.String.pipe(optional),
  location: AbsolutePath,
  source: ManagementSource,
  status: ManagementStatus,
  enabled: Schema.Boolean,
  deletable: Schema.Boolean,
  deleteTarget: AbsolutePath.pipe(optional),
  deleteBlocked: DeleteBlocked.pipe(optional),
}).annotate({ identifier: "SkillV2.ManagementInfo" })
export interface ManagementInfo extends Schema.Schema.Type<typeof ManagementInfo> {}

export const SetEnabledInput = Schema.Struct({ enabled: Schema.Boolean }).annotate({
  identifier: "SkillV2.SetEnabledInput",
})
```

Add `origin: SourceOrigin.pipe(optional)` to `DirectorySource`, `UrlSource`, and `EmbeddedSource`. Keep `Source.equals` and `Source.key` based on the physical source so metadata does not duplicate execution sources.

- [ ] **Step 4: Typecheck Schema and confirm the failing test now reaches registration**

Run from `packages/schema`:

```bash
bun typecheck
```

Run from `packages/core`:

```bash
bun test test/skill.test.ts
```

Expected: Schema typecheck and the focused source round-trip test pass.

- [ ] **Step 5: Commit the schema contract**

```bash
git add packages/schema/src/skill.ts packages/core/test/skill.test.ts
git commit -m "feat(schema): define skill management contracts"
```

### Task 2: Preserve Skill Source Ownership

**Files:**
- Modify: `packages/core/src/config/plugin/skill.ts`
- Modify: `packages/core/src/plugin/skill.ts`
- Modify: `packages/core/src/skill.ts`
- Test: `packages/core/test/config/skill.test.ts`
- Test: `packages/core/test/plugin/skill.test.ts`

- [ ] **Step 1: Make config fixtures identify their declaring files**

In `packages/core/test/config/skill.test.ts`, provide explicit global and project entries:

```ts
new Config.Directory({ type: "directory", path: AbsolutePath.make("/home/test/.config/opencode") }),
new Config.Document({
  type: "document",
  path: "/repo/opencode.json",
  info: decode({ skills: ["./skills", "https://example.test/skills/"] }),
}),
new Config.Directory({ type: "directory", path: AbsolutePath.make("/repo/.opencode") }),
```

Assert global entries use `scope: "global"`, project entries use `scope: "project"`, configured paths use `type: "config-file"`, and discovered `skill`/`skills` directories use `type: "config-directory"`.

- [ ] **Step 2: Run the ownership tests and verify failure**

Run from `packages/core`:

```bash
bun test test/config/skill.test.ts test/plugin/skill.test.ts
```

Expected: FAIL because config and built-in plugins still register metadata-free sources.

- [ ] **Step 3: Attach authoritative origin metadata in the config plugin**

In `packages/core/src/config/plugin/skill.ts`, classify each entry relative to `global.config`, preserve the declaring document path, and register sources in existing precedence order. The source construction should follow this shape:

```ts
const scope = (entry: Config.Entry): SkillV2.Scope => {
  if (!entry.path) return "project"
  const relative = path.relative(path.resolve(global.config), path.resolve(entry.path))
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return "global"
  return "project"
}

draft.source(
  SkillV2.DirectorySource.make({
    type: "directory",
    path: AbsolutePath.make(path.join(entry.path, "skills")),
    origin: { scope: scope(entry), type: "config-directory", value: entry.path },
  }),
)
```

Keep the existing behavior that resolves relative configured paths against
`location.directory`; use the declaring document path only as origin metadata.
Do not change URL validation or source ordering.

- [ ] **Step 4: Mark the embedded Skill as built-in**

Update `packages/core/src/plugin/skill.ts` by inserting the origin field beside
the existing `type` field. Leave the existing embedded `skill` object byte-for-byte
unchanged:

```ts
origin: { scope: "global", type: "builtin", value: "customize-opencode" },
```

- [ ] **Step 5: Update duplicate source registration to retain later metadata**

In `packages/core/src/skill.ts`, make `Draft.source` replace a physically equal source in place when the later registration contains origin metadata. This keeps one load and preserves the established source position:

```ts
source: (source) => {
  const index = draft.sources.findIndex((item) => Source.equals(item, source))
  if (index === -1) {
    draft.sources.push(source as Types.DeepMutable<Source>)
    return
  }
  if (!source.origin) return
  draft.sources[index] = source as Types.DeepMutable<Source>
},
```

- [ ] **Step 6: Run focused tests and typecheck Core**

Run from `packages/core`:

```bash
bun test test/config/skill.test.ts test/plugin/skill.test.ts test/skill.test.ts
bun typecheck
```

Expected: all focused tests and Core typecheck pass.

- [ ] **Step 7: Commit source ownership**

```bash
git add packages/core/src/config/plugin/skill.ts packages/core/src/plugin/skill.ts packages/core/src/skill.ts packages/core/test/config/skill.test.ts packages/core/test/plugin/skill.test.ts
git commit -m "feat(core): track skill source ownership"
```

### Task 3: Add Installed and Effective Skill Views

**Files:**
- Create: `packages/core/src/skill/management.ts`
- Modify: `packages/core/src/skill.ts`
- Test: `packages/core/test/skill.test.ts`

- [ ] **Step 1: Write duplicate and status tests**

Extend `packages/core/test/skill.test.ts` with two directory sources containing the same Skill name. Assert management retains both rows, the later row is active, the earlier row is shadowed, and `list()` still returns only the later content:

```ts
const managed = yield* skill.management.list()
expect(managed.map((item) => ({ description: item.description, status: item.status }))).toEqual([
  { description: "First", status: "shadowed" },
  { description: "Second", status: "active" },
])
expect((yield* skill.list()).map((item) => item.description)).toEqual(["Second"])
expect(managed.every((item) => !("content" in item))).toBe(true)
```

Also register an origin-free directory source and assert its management source is `plugin`, its scope is inferred, and it is not deletable.

- [ ] **Step 2: Run the Skill test and verify the management API is absent**

Run from `packages/core`:

```bash
bun test test/skill.test.ts
```

Expected: FAIL because `skill.management` does not exist.

- [ ] **Step 3: Implement pure installation identity and projection helpers**

Create `packages/core/src/skill/management.ts` with exported pure functions following these contracts:

```ts
export type Installed = {
  source: Skill.Source
  info: Skill.Info
}

export function id(entry: Installed) {
  return Skill.ManagementID.make(
    Hash.sha256([Skill.Source.key(entry.source), entry.info.name, entry.info.location].join("\0")),
  )
}

export function project(entries: readonly Installed[], disabled: ReadonlySet<Skill.ManagementID>) {
  const enabled = entries.filter((entry) => !disabled.has(id(entry)))
  const active = new Map(enabled.map((entry) => [entry.info.name, id(entry)]))
  return entries.map((entry) => {
    const installationID = id(entry)
    const isEnabled = !disabled.has(installationID)
    return toInfo(entry, installationID, isEnabled ? (active.get(entry.info.name) === installationID ? "active" : "shadowed") : "disabled")
  })
}
```

`toInfo` must map built-in, directory, URL, and origin-free sources into `ManagementInfo`, omit content, infer plugin scope conservatively, and return `deleteBlocked: "plugin"` for metadata-free sources. Export a separate `effective(entries, disabled)` helper that filters disabled entries and applies the same last-source-wins rule used by the current `list()` method.

- [ ] **Step 4: Load all installations before deduplication**

Modify `packages/core/src/skill.ts` so the source cache remains `Map<string, Info[]>`, but add an `installed()` function that pairs each loaded `Info` with its source. Make `list()` call the pure `effective` helper. Add the service shape without mutation methods yet:

```ts
export interface Interface extends State.Transformable<Draft> {
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: () => Effect.Effect<Info[]>
  readonly management: {
    readonly list: () => Effect.Effect<ManagementInfo[]>
  }
}
```

Use an empty disabled set in this task so behavior is unchanged until persistence is added.

- [ ] **Step 5: Run focused tests and Core typecheck**

Run from `packages/core`:

```bash
bun test test/skill.test.ts test/plugin/skill.test.ts test/tool-skill.test.ts test/skill/guidance.test.ts
bun typecheck
```

Expected: duplicate management tests pass; existing execution and permission behavior remains green.

- [ ] **Step 6: Commit the two-view runtime model**

```bash
git add packages/core/src/skill.ts packages/core/src/skill/management.ts packages/core/test/skill.test.ts
git commit -m "feat(core): expose managed skill installations"
```

### Task 4: Persist Enable and Disable State

**Files:**
- Modify: `packages/core/src/skill/management.ts`
- Modify: `packages/core/src/skill.ts`
- Test: `packages/core/test/skill.test.ts`

- [ ] **Step 1: Write persistence and scope-isolation tests**

Build the Skill test layer with temporary `Global.state`, distinct `Location.project.id` values, and `EffectFlock.node`. Cover these outcomes:

```ts
const first = (yield* skill.management.list()).find((item) => item.description === "Second")!
yield* skill.management.setEnabled(first.id, false)
expect((yield* skill.management.list()).find((item) => item.id === first.id)?.status).toBe("disabled")
expect((yield* skill.list()).map((item) => item.description)).toEqual(["First"])

const projectKey = Hash.sha256(
  projectID === Project.ID.global
    ? [projectID, projectRoot, locationDirectory].join("\0")
    : [projectID, projectRoot].join("\0"),
)
const state = JSON.parse(await fs.readFile(path.join(stateRoot, "skills", "projects", `${projectKey}.json`), "utf8"))
expect(state).toEqual({ version: 1, disabled: [first.id] })
```

Create a second location with another project ID and assert the project-scoped
ID remains enabled there. Also create two non-Git locations that both use
`Project.ID.global` and the same filesystem-root project directory, and prove
their distinct opened directories remain isolated. Create two locations in the
same Git project with different opened subdirectories and prove they share
project state.
Register a global source in both locations and assert disabling it is visible
in both. Write malformed JSON and assert management defaults to enabled while
logging a warning.

- [ ] **Step 2: Run the focused test and verify mutations are absent**

Run from `packages/core`:

```bash
bun test test/skill.test.ts
```

Expected: FAIL because `setEnabled` and state persistence do not exist.

- [ ] **Step 3: Implement versioned state loading and atomic writes**

Add a management state schema and state paths to `packages/core/src/skill/management.ts`:

```ts
const Persisted = Schema.Struct({
  version: Schema.Literal(1),
  disabled: Schema.Array(Skill.ManagementID),
})

export function stateFile(input: {
  state: string
  projectID: Project.ID
  projectRoot: AbsolutePath
  locationDirectory: AbsolutePath
  scope: Skill.Scope
}) {
  if (input.scope === "global") return path.join(input.state, "skills", "global.json")
  const key = Hash.sha256(
    input.projectID === Project.ID.global
      ? [input.projectID, input.projectRoot, input.locationDirectory].join("\0")
      : [input.projectID, input.projectRoot].join("\0"),
  )
  return path.join(input.state, "skills", "projects", `${key}.json`)
}
```

Implement `readDisabled`, `writeDisabled`, and `setEnabled`. Decode with `Schema.decodeUnknownOption`, sort IDs before writing, write `<file>.tmp-<uuid>`, then rename it over the destination. Wrap the read-modify-write sequence in `EffectFlock.Service.withLock` using the final state path as the lock key. On decode failure, log a warning containing only the state path and default to an empty set.

- [ ] **Step 4: Wire state into SkillV2.Service**

Add `Global.Service`, `Location.Service`, and `EffectFlock.Service` to the Skill layer. Load both global and project disabled sets for management projection, and select the correct state file from each row's source scope. Add the mutation method:

```ts
readonly management: {
  readonly list: () => Effect.Effect<ManagementInfo[]>
  readonly setEnabled: (id: ManagementID, enabled: boolean) => Effect.Effect<ManagementInfo[], NotFoundError | OperationError>
}
```

Define `NotFoundError` with the installation ID and `OperationError` with a safe operation literal. `setEnabled` must resolve the current installation first, fail without writing when absent, persist the change, and return a freshly projected management list.

- [ ] **Step 5: Run persistence tests and broad Skill tests**

Run from `packages/core`:

```bash
bun test test/skill.test.ts test/tool-skill.test.ts test/skill/guidance.test.ts test/config/skill.test.ts test/plugin/skill.test.ts
bun typecheck
```

Expected: persistence, scope isolation, fallback, and all existing Skill behavior pass.

- [ ] **Step 6: Commit enable and disable persistence**

```bash
git add packages/core/src/skill.ts packages/core/src/skill/management.ts packages/core/test/skill.test.ts
git commit -m "feat(core): persist skill enable state"
```

### Task 5: Add Recoverable and Safe Local Deletion

**Files:**
- Modify: `packages/core/src/skill/management.ts`
- Modify: `packages/core/src/skill.ts`
- Test: `packages/core/test/skill.test.ts`

- [ ] **Step 1: Write deletion safety tests**

Add table-driven tests for a normal `skill/SKILL.md`, a root `name.md`, the source root itself, a symlinked Skill, an embedded Skill, a URL Skill, and an origin-free plugin source. Assert only the first two expose `deletable: true` and an exact `deleteTarget`.

Add a recovery test:

```ts
const item = (yield* skill.management.list()).find((entry) => entry.name === "review")!
const next = yield* skill.management.remove(item.id)
expect(await fs.stat(path.dirname(item.location)).catch(() => undefined)).toBeUndefined()
expect(next.some((entry) => entry.id === item.id)).toBe(false)
const trash = await fs.readdir(path.join(stateRoot, "skills", "trash"))
expect(trash).toHaveLength(1)
expect(JSON.parse(await fs.readFile(path.join(stateRoot, "skills", "trash", trash[0]!, "metadata.json"), "utf8"))).toMatchObject({
  id: item.id,
  originalPath: path.dirname(item.location),
})
```

Assert rejected deletions leave the original file in place and return `ProtectedError` or `UnsafePathError`.

- [ ] **Step 2: Run deletion tests and verify failure**

Run from `packages/core`:

```bash
bun test test/skill.test.ts
```

Expected: FAIL because deletion metadata and `management.remove` are absent.

- [ ] **Step 3: Resolve deletable targets without following unsafe links**

In `packages/core/src/skill/management.ts`, implement `deleteTarget(entry, fs)` with these exact rules:

```ts
const sourceRoot = path.resolve(entry.source.path)
const skillFile = path.resolve(entry.info.location)
const candidate = path.basename(skillFile) === "SKILL.md" ? path.dirname(skillFile) : skillFile
if (candidate === sourceRoot || !FSUtil.contains(sourceRoot, candidate)) return { blocked: "unsafe" as const }
const sourceReal = yield* fs.realPath(sourceRoot)
const candidateReal = yield* fs.realPath(candidate)
if (candidateReal === sourceReal || !FSUtil.contains(sourceReal, candidateReal)) return { blocked: "unsafe" as const }
if (sourceReal !== sourceRoot || candidateReal !== candidate) return { blocked: "unsafe" as const }
return { target: AbsolutePath.make(candidate) }
```

Run this only for directory sources whose origin is `config-directory` or `config-file`. Embedded, URL, and plugin-owned sources return their protected reason without touching the filesystem.

- [ ] **Step 4: Move the Skill into a recovery record**

Implement `remove` under the same state lock used for toggles. Create a unique recovery directory at `Global.state/skills/trash/<timestamp>-<id-prefix>-<uuid>`, write metadata into a staging directory, rename the Skill target into `payload`, then rename staging to the final record. If any step before the final rename fails, move `payload` back when present and remove staging. Do not delete the original on a failed move.

After success, clear the affected source cache key, remove the deleted ID from its disabled state file, and return a fresh management list.

- [ ] **Step 5: Run deletion and runtime tests**

Run from `packages/core`:

```bash
bun test test/skill.test.ts test/tool-skill.test.ts test/skill/guidance.test.ts
bun typecheck
```

Expected: safe deletion, rollback protection, cache invalidation, and runtime tests pass.

- [ ] **Step 6: Commit deletion support**

```bash
git add packages/core/src/skill.ts packages/core/src/skill/management.ts packages/core/test/skill.test.ts
git commit -m "feat(core): add recoverable skill deletion"
```

### Task 6: Expose Management Through Protocol, Server, and Client

**Files:**
- Modify: `packages/protocol/src/groups/skill.ts`
- Modify: `packages/server/src/handlers/skill.ts`
- Modify: `packages/client/src/contract.ts`
- Modify generated files under `packages/client/src/generated/`
- Modify generated files under `packages/client/src/generated-effect/`
- Test: `packages/client/test/contract-identity.test.ts`
- Test: `packages/opencode/test/server/httpapi-v2-location.test.ts`

- [ ] **Step 1: Extend the location-route contract test**

In `packages/opencode/test/server/httpapi-v2-location.test.ts`, include the
management list in the existing GET location-scoping assertion:

```ts
const skillRoutes = [
  "/api/skill",
  "/api/skill/management",
]
```

Add a separate integration test that reads a real management ID, patches its
enabled state, and deletes a disposable local Skill with the correct HTTP
methods. Add generated-client type assertions in
`packages/client/test/contract-identity.test.ts` that Promise and Effect clients
both expose management list, set-enabled, and remove endpoints.

- [ ] **Step 2: Run contract tests and verify the endpoints are absent**

Run from `packages/client`:

```bash
bun test test/contract-identity.test.ts
```

Run from `packages/opencode`:

```bash
bun test test/server/httpapi-v2-location.test.ts
```

Expected: FAIL because the management endpoints and generated methods do not exist.

- [ ] **Step 3: Define HTTP errors and endpoints**

Extend `packages/protocol/src/groups/skill.ts` with status-bearing error schemas:

```ts
export class SkillManagementNotFoundError extends Schema.ErrorClass<SkillManagementNotFoundError>(
  "SkillManagementNotFoundError",
)({ id: Skill.ManagementID, message: Schema.String }, { httpApiStatus: 404 }) {}

export class SkillManagementForbiddenError extends Schema.ErrorClass<SkillManagementForbiddenError>(
  "SkillManagementForbiddenError",
)({ id: Skill.ManagementID, reason: Skill.DeleteBlocked, message: Schema.String }, { httpApiStatus: 403 }) {}

export class SkillManagementOperationError extends Schema.ErrorClass<SkillManagementOperationError>(
  "SkillManagementOperationError",
)({ operation: Schema.Literals(["read", "write", "delete"]), message: Schema.String }, { httpApiStatus: 500 }) {}
```

Add `skill.management.list`, `skill.management.setEnabled`, and `skill.management.remove` endpoints. All use `LocationQuery`; mutations use `{ id: Skill.ManagementID }` params; patch uses `Skill.SetEnabledInput`; success is `Location.response(Schema.Array(Skill.ManagementInfo))`; errors use the appropriate union.

Add stable generated method names in `packages/client/src/contract.ts`:

```ts
"skill.management.list": "managementList",
"skill.management.setEnabled": "managementSetEnabled",
"skill.management.remove": "managementRemove",
```

- [ ] **Step 4: Map core operations in the Server handler**

Extend `packages/server/src/handlers/skill.ts` so every success passes through the existing `response` helper. Map core tags explicitly:

```ts
const managementError = (error: SkillV2.ManagementError) => {
  if (error._tag === "SkillV2.NotFoundError") {
    return new SkillManagementNotFoundError({ id: error.id, message: "Skill installation not found." })
  }
  if (error._tag === "SkillV2.ProtectedError" || error._tag === "SkillV2.UnsafePathError") {
    return new SkillManagementForbiddenError({ id: error.id, reason: error.reason, message: "Skill cannot be deleted." })
  }
  return new SkillManagementOperationError({ operation: error.operation, message: "Skill management operation failed." })
}
```

Do not include filesystem paths, file content, or platform error details in server error messages.

- [ ] **Step 5: Generate both clients**

Run from `packages/client`:

```bash
bun run generate
```

Do not edit generated files manually.

- [ ] **Step 6: Run Protocol, Server, Client, and route checks**

Run:

```bash
cd packages/protocol && bun typecheck
cd ../server && bun typecheck
cd ../client && bun test test/contract-identity.test.ts && bun typecheck
cd ../opencode && bun test test/server/httpapi-v2-location.test.ts
```

Expected: all commands pass and the generated Promise API exposes
`skills.managementList`, `skills.managementSetEnabled`, and
`skills.managementRemove`.

- [ ] **Step 7: Commit the public API and generated clients**

```bash
git add packages/protocol/src/groups/skill.ts packages/server/src/handlers/skill.ts packages/client/src/contract.ts packages/client/src/generated packages/client/src/generated-effect packages/client/test/contract-identity.test.ts packages/opencode/test/server/httpapi-v2-location.test.ts
git commit -m "feat(server): expose skill management API"
```

### Task 7: Build the Desktop Skill Management Page

**Files:**
- Create: `packages/app/src/components/settings-v2/skills-controller.ts`
- Create: `packages/app/src/components/settings-v2/skills-controller.test.ts`
- Create: `packages/app/src/components/settings-v2/skills.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `packages/app/src/components/settings-v2/settings-v2.css`
- Modify: `packages/app/src/context/server-sdk.tsx`
- Create: `packages/app/src/utils/skill-management-api.ts`
- Create: `packages/app/src/utils/skill-management-api.test.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/app/src/i18n/zht.ts`
- Modify: every other dictionary under `packages/app/src/i18n/`
- Test: `packages/app/src/i18n/parity.test.ts`

- [ ] **Step 1: Write pure filtering and label tests**

Create `packages/app/src/components/settings-v2/skills-controller.test.ts` with fixtures for active, disabled, shadowed, built-in, remote, project, and global rows. Assert:

```ts
expect(filterSkills(items, { query: "deploy", status: "all" }).map((item) => item.name)).toEqual(["deploy"])
expect(filterSkills(items, { query: "/repo/.opencode", status: "all" }).map((item) => item.name)).toEqual(["review"])
expect(filterSkills(items, { query: "", status: "disabled" }).every((item) => item.status === "disabled")).toBe(true)
expect(sourceKey(items[0]!)).toBe("settings.skills.source.project")
expect(statusKey(items[0]!)).toBe("settings.skills.status.active")
```

Add a pending-state test proving only the affected installation ID is disabled during a mutation.

- [ ] **Step 2: Run the controller test and verify failure**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2/skills-controller.test.ts
```

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement pure presentation helpers**

Create `packages/app/src/components/settings-v2/skills-controller.ts`:

```ts
import { Skill } from "@opencode-ai/schema/skill"

export type SkillStatusFilter = "all" | Skill.ManagementInfo["status"]

export function filterSkills(
  items: readonly Skill.ManagementInfo[],
  input: { query: string; status: SkillStatusFilter },
) {
  const query = input.query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (input.status !== "all" && item.status !== input.status) return false
    if (!query) return true
    return [item.name, item.description, item.location, item.source.value]
      .filter((value): value is string => value !== undefined)
      .some((value) => value.toLocaleLowerCase().includes(query))
  })
}

export function sourceKey(item: Skill.ManagementInfo) {
  if (item.source.type === "builtin") return "settings.skills.source.builtin" as const
  if (item.source.type === "url") return "settings.skills.source.remote" as const
  if (item.source.type === "plugin") return "settings.skills.source.plugin" as const
  return item.source.scope === "global"
    ? ("settings.skills.source.global" as const)
    : ("settings.skills.source.project" as const)
}
```

Add `statusKey`, `scopeKey`, and `isPending(pendingID, item)` as small pure helpers.

- [ ] **Step 4: Add all locale keys while preserving parity**

Add a `settings.skills.*` block to every app dictionary. English, Simplified Chinese, and Traditional Chinese must contain native copy for title, count, search, four filters, source/scope/status labels, empty states, location requirement, switch labels, delete dialog, progress, success, and failure. Use the English values as explicit fallback entries in the remaining locale files so the parity test stays exact.

Required delete copy must include `{{name}}` and `{{path}}` placeholders in every locale:

```ts
"settings.skills.delete.confirm": "Remove {{name}} from GUaI Code and move {{path}} to the recovery area?",
"settings.skills.delete.confirm": "要从 GUaI Code 中删除 {{name}}，并将 {{path}} 移入恢复区吗？",
"settings.skills.delete.confirm": "要從 GUaI Code 中刪除 {{name}}，並將 {{path}} 移入復原區嗎？",
```

- [ ] **Step 5: Implement the authenticated management API and settings page**

Create `packages/app/src/utils/skill-management-api.ts` as a narrow adapter for
the three new routes. It receives `baseUrl`, optional authenticated headers,
and a fetch implementation, encodes the deep-object location query, checks
`response.ok`, and decodes the location-wrapped JSON with:

```ts
const ManagementResponse = Location.response(Schema.Array(Skill.ManagementInfo))
const decodeManagementResponse = Schema.decodeUnknownPromise(ManagementResponse)
```

Its public shape is:

```ts
export type SkillManagementApi = {
  list: (directory: string) => Promise<Skill.ManagementInfo[]>
  setEnabled: (directory: string, id: Skill.ManagementID, enabled: boolean) => Promise<Skill.ManagementInfo[]>
  remove: (directory: string, id: Skill.ManagementID) => Promise<Skill.ManagementInfo[]>
}
```

Test exact GET, PATCH, and DELETE URLs, the PATCH JSON body, Basic
Authorization preservation, successful `data` extraction, and a safe error on
non-2xx responses. Then construct this adapter in
`packages/app/src/context/server-sdk.tsx` using the same server credentials and
platform fetch as `currentApi`, and expose it as `skillManagement` on
`ServerSDKBase`.

Create `packages/app/src/components/settings-v2/skills.tsx`. Use `useServerSDK`,
`useQuery`, and `useQueryClient` with query key
`[serverSDK().scope, props.directory, "skill-management"]`. Query through:

```ts
serverSDK().skillManagement.list(props.directory!)
```

Render:

- a stable sticky header with title, count, search, and `SegmentedControlV2` status filter;
- one `SettingsListV2` containing dense Skill rows;
- `Tag` components for source, scope, and status;
- selectable path/URL text;
- a `Switch` whose checked value changes only after the mutation response updates query data;
- a trash icon only when `deletable` is true;
- a V2 confirmation dialog showing exact name and `deleteTarget`;
- location-required, loading, no-installed, and no-match states.

Use one pending installation ID signal for switch/delete disabling. On errors, call `showToast` with `common.requestFailed` and localized action-specific text. On success, set the returned list directly with `queryClient.setQueryData`.

- [ ] **Step 6: Register the tab with active-directory routing**

Modify `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`:

```ts
export type SettingsTab = "general" | "shortcuts" | "models" | "providers" | "servers" | "skills"
```

Add a server-section trigger using the existing `tools` or closest available Skill-related icon, and render:

```tsx
<TabsV2.Content value="skills" class="settings-v2-panel">
  <SettingsSkillsV2 directory={directory()} />
</TabsV2.Content>
```

Do not add a create or install action.

- [ ] **Step 7: Add stable responsive styling**

Extend `packages/app/src/components/settings-v2/settings-v2.css` with `.settings-v2-skills-*` rules. Use a row grid with `minmax(0, 1fr) auto`, stable 32px action tracks, path ellipsis at wide widths, wrapping below 640px, and no nested cards. Keep tags and switches from resizing the row when status changes. Reuse V2 color tokens and the existing 8px list radius.

- [ ] **Step 8: Run controller, i18n, and App type checks**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2/skills-controller.test.ts src/utils/skill-management-api.test.ts src/i18n/parity.test.ts
bun typecheck
```

Expected: filtering, presentation, dictionary parity, and App typecheck pass.

- [ ] **Step 9: Commit the desktop manager**

```bash
git add packages/app/src/components/settings-v2/skills-controller.ts packages/app/src/components/settings-v2/skills-controller.test.ts packages/app/src/components/settings-v2/skills.tsx packages/app/src/components/settings-v2/dialog-settings-v2.tsx packages/app/src/components/settings-v2/settings-v2.css packages/app/src/context/server-sdk.tsx packages/app/src/utils/skill-management-api.ts packages/app/src/utils/skill-management-api.test.ts packages/app/src/i18n
git commit -m "feat(app): add skill management settings"
```

### Task 8: Complete Integration and Visual Verification

**Files:**
- Modify only files whose verification reveals a defect.
- Verify: `docs/superpowers/specs/2026-08-08-skill-management-design.md`

- [ ] **Step 1: Run focused package suites**

Run each command from its package, never from the repository root:

```bash
cd packages/schema && bun typecheck
cd ../core && bun test test/skill.test.ts test/config/skill.test.ts test/plugin/skill.test.ts test/tool-skill.test.ts test/skill/guidance.test.ts && bun typecheck
cd ../protocol && bun typecheck
cd ../server && bun typecheck
cd ../client && bun test test/contract-identity.test.ts && bun typecheck && bun run check:generated
cd ../app && bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2/skills-controller.test.ts src/utils/skill-management-api.test.ts src/i18n/parity.test.ts && bun typecheck
cd ../opencode && bun test test/server/httpapi-v2-location.test.ts
```

Expected: every command passes and generated-client check reports no diff.

- [ ] **Step 2: Start the app development server**

Run from `packages/app`:

```bash
bun run dev -- --host 127.0.0.1
```

Expected: Vite prints a reachable local URL. Keep the process running for visual verification.

- [ ] **Step 3: Verify the page with a disposable local Skill**

Create a disposable Skill under a temporary project fixture through the test harness, not in the user's project Skill directories. Open that fixture location in GUaI Code and verify:

1. Settings contains the Skills tab and no create action.
2. Name, description, source, scope, path, status, and switch are visible.
3. A duplicate-name fixture shows active and shadowed rows.
4. Disabling the active row removes it from `GET /api/skill` and reveals the fallback row.
5. Re-enabling restores the active row.
6. Deleting the disposable local Skill shows exact name/path confirmation, removes it from the list, and creates one recovery record.
7. Built-in and remote fixtures have no delete action.

- [ ] **Step 4: Capture desktop and compact screenshots**

Use browser automation to inspect light and dark themes at 1440x900 and 900x700. Confirm long descriptions and paths do not overlap tags, switches, or delete actions; the list scrolls; focus order reaches filters, switches, and delete confirmation; and empty states remain inside the panel.

- [ ] **Step 5: Audit every acceptance criterion against evidence**

Read the 11 acceptance criteria in `docs/superpowers/specs/2026-08-08-skill-management-design.md` and record one concrete source, test, HTTP response, state file, recovery record, or screenshot proving each item. Treat any criterion without direct evidence as unfinished and correct it before proceeding.

- [ ] **Step 6: Inspect the final diff for unrelated changes and unsafe data**

Run from the repository root:

```bash
git status --short
git diff --check dev...HEAD
git diff --stat dev...HEAD
rg -n "SKILL\.md.*content|api[_-]?key|secret|token" packages/app/src/components/settings-v2/skills.tsx packages/core/src/skill packages/server/src/handlers/skill.ts
```

Expected: no whitespace errors, no generated drift, no secret material, no Skill content in management responses, and no unrelated `.superpowers/` files staged.

- [ ] **Step 7: Commit verification fixes if any were required**

If verification required code changes, stage only those files and commit:

```bash
git add packages/schema/src/skill.ts packages/core/src/skill.ts packages/core/src/skill/management.ts packages/core/src/config/plugin/skill.ts packages/core/src/plugin/skill.ts packages/protocol/src/groups/skill.ts packages/server/src/handlers/skill.ts packages/client/src/contract.ts packages/client/src/generated packages/client/src/generated-effect packages/app/src/components/settings-v2 packages/app/src/context/server-sdk.tsx packages/app/src/utils/skill-management-api.ts packages/app/src/utils/skill-management-api.test.ts packages/app/src/i18n
git commit -m "fix(app): finish skill management verification"
```

If no files changed, do not create an empty commit.

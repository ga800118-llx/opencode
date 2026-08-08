import { randomUUID } from "crypto"
import path from "path"
import { Cause, Effect, Exit, Ref, Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { FSUtil } from "../fs-util"
import type { Global } from "../global"
import type { Location } from "../location"
import { Project } from "../project"
import { AbsolutePath } from "../schema"
import type { EffectFlock } from "../util/effect-flock"
import { Hash } from "../util/hash"
import { SkillSafeMove } from "./safe-move"

export type Installed = {
  source: Skill.Source
  info: Skill.Info
}

export type DisabledState = {
  readonly global: ReadonlySet<Skill.ManagementID>
  readonly project: ReadonlySet<Skill.ManagementID>
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SkillV2.NotFoundError", {
  id: Skill.ManagementID,
}) {}

export class OperationError extends Schema.TaggedErrorClass<OperationError>()("SkillV2.OperationError", {
  operation: Schema.Literals(["read", "write", "delete"]),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ProtectedError extends Schema.TaggedErrorClass<ProtectedError>()("SkillV2.ProtectedError", {
  id: Skill.ManagementID,
  reason: Skill.DeleteBlocked,
}) {}

export class UnsafePathError extends Schema.TaggedErrorClass<UnsafePathError>()("SkillV2.UnsafePathError", {
  id: Skill.ManagementID,
  reason: Schema.Literal("unsafe"),
}) {}

export type ManagementError = NotFoundError | OperationError | ProtectedError | UnsafePathError

export type DeletionTarget = { readonly target: AbsolutePath } | { readonly blocked: typeof Skill.DeleteBlocked.Type }

type VerifiedDeletionTarget = {
  readonly target: AbsolutePath
  readonly sourceRoot: AbsolutePath
  readonly relative: string
}

const StateFile = Schema.Struct({
  version: Schema.Literal(1),
  disabled: Schema.Array(Skill.ManagementID),
})
const StateFileJson = Schema.fromJsonString(StateFile)
const decodeStateFile = Schema.decodeUnknownEffect(StateFileJson)

export function id(entry: Installed) {
  return Skill.ManagementID.make(
    Hash.sha256([Skill.Source.key(entry.source), entry.info.name, entry.info.location].join("\0")),
  )
}

export function scope(input: Skill.Source) {
  return source(input).scope
}

export function statePaths(global: Global.Interface, location: Location.Interface) {
  const root = path.join(global.state, "skills")
  const projectKey = Hash.sha256(
    location.project.id === Project.ID.global
      ? [location.project.id, location.project.directory, location.directory].join("\0")
      : [location.project.id, location.project.directory].join("\0"),
  )
  return {
    global: path.join(root, "global.json"),
    project: path.join(root, "projects", `${projectKey}.json`),
  }
}

export function readState(fs: FSUtil.Interface, file: string) {
  return readStateForMutation(fs, file).pipe(Effect.catch(() => warn(file)))
}

export function updateState(
  fs: FSUtil.Interface,
  flock: EffectFlock.Interface,
  file: string,
  installationID: Skill.ManagementID,
  enabled: boolean,
) {
  return withStateLock(
    flock,
    file,
    "write",
    updateStateUnlocked(fs, file, installationID, enabled).pipe(
      Effect.mapError((cause) =>
        cause instanceof OperationError && cause.operation === "write"
          ? cause
          : new OperationError({ operation: "write", cause }),
      ),
    ),
  )
}

export function updateStateIfInstalled(
  fs: FSUtil.Interface,
  flock: EffectFlock.Interface,
  file: string,
  installationID: Skill.ManagementID,
  enabled: boolean,
  expectedScope: "global" | "project",
  refresh: () => Effect.Effect<Installed[]>,
) {
  return withStateLock(
    flock,
    file,
    "write",
    Effect.gen(function* () {
      const installation = (yield* refresh()).find((entry) => id(entry) === installationID)
      if (!installation || scope(installation.source) !== expectedScope) {
        return yield* new NotFoundError({ id: installationID })
      }
      yield* updateStateUnlocked(fs, file, installationID, enabled)
      return undefined
    }),
  )
}

export function deleteTarget(
  entry: Installed,
  fs: FSUtil.Interface,
  safeMove: SkillSafeMove.Interface,
): Effect.Effect<DeletionTarget> {
  return resolveDeleteTarget(entry, fs, safeMove).pipe(
    Effect.catch(() => Effect.succeed({ blocked: "unsafe" as const })),
  )
}

function resolveDeleteTarget(
  entry: Installed,
  fs: FSUtil.Interface,
  safeMove: SkillSafeMove.Interface,
  knownSourceReal?: string,
  knownAvailable?: boolean,
): Effect.Effect<DeletionTarget, FSUtil.Error> {
  const sourceInfo = source(entry.source)
  if (sourceInfo.type === "builtin") return Effect.succeed({ blocked: "builtin" })
  if (sourceInfo.type === "url") return Effect.succeed({ blocked: "remote" })
  if (sourceInfo.type === "plugin") return Effect.succeed({ blocked: "plugin" })
  if (entry.source.type !== "directory") return Effect.succeed({ blocked: "unsafe" })
  if (entry.source.origin?.type !== "config-directory" && entry.source.origin?.type !== "config-file") {
    return Effect.succeed({ blocked: "plugin" })
  }

  const sourceRoot = path.resolve(entry.source.path)
  const skillFile = path.resolve(entry.info.location)
  const candidate = path.basename(skillFile) === "SKILL.md" ? path.dirname(skillFile) : skillFile
  if (candidate === sourceRoot || !FSUtil.contains(sourceRoot, candidate)) return Effect.succeed({ blocked: "unsafe" })
  return Effect.gen(function* () {
    if (!(knownAvailable ?? (yield* safeMove.available()))) return { blocked: "unsafe" as const }
    const sourceReal = knownSourceReal ?? (yield* fs.realPath(sourceRoot))
    const candidateReal = yield* fs.realPath(candidate)
    if (candidateReal === sourceReal || !FSUtil.contains(sourceReal, candidateReal))
      return { blocked: "unsafe" as const }
    if (sourceReal !== sourceRoot || candidateReal !== candidate) return { blocked: "unsafe" as const }
    return { target: AbsolutePath.make(candidate) }
  })
}

function requireMutationTarget(entry: Installed, installationID: Skill.ManagementID) {
  const sourceInfo = source(entry.source)
  if (sourceInfo.type === "builtin") return Effect.fail(new ProtectedError({ id: installationID, reason: "builtin" }))
  if (sourceInfo.type === "url") return Effect.fail(new ProtectedError({ id: installationID, reason: "remote" }))
  if (sourceInfo.type === "plugin") return Effect.fail(new ProtectedError({ id: installationID, reason: "plugin" }))
  if (
    entry.source.type !== "directory" ||
    (entry.source.origin?.type !== "config-directory" && entry.source.origin?.type !== "config-file")
  ) {
    return Effect.fail(new UnsafePathError({ id: installationID, reason: "unsafe" }))
  }
  const sourceRoot = AbsolutePath.make(path.resolve(entry.source.path))
  const skillFile = path.resolve(entry.info.location)
  const candidate = path.basename(skillFile) === "SKILL.md" ? path.dirname(skillFile) : skillFile
  if (candidate === sourceRoot || !FSUtil.contains(sourceRoot, candidate)) {
    return Effect.fail(new UnsafePathError({ id: installationID, reason: "unsafe" }))
  }
  return Effect.succeed({
    target: AbsolutePath.make(candidate),
    sourceRoot,
    relative: path.relative(sourceRoot, candidate),
  } satisfies VerifiedDeletionTarget)
}

export function management(
  entries: readonly Installed[],
  disabled: DisabledState,
  fs: FSUtil.Interface,
  safeMove: SkillSafeMove.Interface,
) {
  return Effect.gen(function* () {
    const available = entries.some(
      (entry) =>
        entry.source.type === "directory" &&
        (entry.source.origin?.type === "config-directory" || entry.source.origin?.type === "config-file"),
    )
      ? yield* safeMove.available()
      : false
    const roots = new Map<string, string | undefined>()
    const targets = yield* Effect.forEach(entries, (entry) => {
      const skillSource = entry.source
      if (
        skillSource.type !== "directory" ||
        (skillSource.origin?.type !== "config-directory" && skillSource.origin?.type !== "config-file") ||
        !available
      ) {
        return resolveDeleteTarget(entry, fs, safeMove, undefined, available).pipe(
          Effect.catch(() => Effect.succeed({ blocked: "unsafe" as const })),
        )
      }
      const key = Skill.Source.key(skillSource)
      return Effect.gen(function* () {
        if (!roots.has(key)) {
          const canonical = yield* fs.realPath(path.resolve(skillSource.path)).pipe(
            Effect.map((value): string | undefined => value),
            Effect.catch(() => Effect.succeed(undefined)),
          )
          roots.set(key, canonical)
        }
        const canonical = roots.get(key)
        if (canonical === undefined) return { blocked: "unsafe" as const }
        return yield* resolveDeleteTarget(entry, fs, safeMove, canonical, available).pipe(
          Effect.catch(() => Effect.succeed({ blocked: "unsafe" as const })),
        )
      })
    })
    return project(entries, disabled, targets)
  })
}

export function remove(
  fs: FSUtil.Interface,
  safeMove: SkillSafeMove.Interface,
  flock: EffectFlock.Interface,
  global: Global.Interface,
  file: string,
  entry: Installed,
  refresh?: () => Effect.Effect<Installed[]>,
) {
  const installationID = id(entry)
  return Effect.gen(function* () {
    yield* requireMutationTarget(entry, installationID)
    return yield* withDeleteLock(
      flock,
      file,
      Effect.gen(function* () {
        const trashRoot = path.join(global.state, "skills", "trash")
        yield* fs.makeDirectory(trashRoot, { recursive: true })
        const current = refresh ? (yield* refresh()).find((installation) => id(installation) === installationID) : entry
        if (!current) return yield* new NotFoundError({ id: installationID })
        const verified = yield* requireMutationTarget(current, installationID)
        const deletedAt = new Date().toISOString()
        const record = `${Date.now()}-${installationID.slice(0, 12)}-${randomUUID()}`
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* safeMove
              .prepare({
                sourceRoot: verified.sourceRoot,
                source: verified.relative,
                trashRoot,
                staging: `${record}.staging`,
                final: record,
              })
              .pipe(Effect.mapError((error) => safeMoveError(installationID, error)))
            const latest = refresh
              ? (yield* refresh()).find((installation) => id(installation) === installationID)
              : current
            if (!latest || !sameInstallation(current, latest)) return yield* new NotFoundError({ id: installationID })
            const latestTarget = yield* requireMutationTarget(latest, installationID)
            if (latestTarget.target !== verified.target || handle.target !== verified.target) {
              return yield* new UnsafePathError({ id: installationID, reason: "unsafe" })
            }
            const previous = yield* readStateRecord(fs, file)
            const disabled = new Set(previous.disabled)
            const stateChanged = disabled.delete(installationID)
            const stateTouched = yield* Ref.make(false)
            const transaction = withCompensation(
              Effect.gen(function* () {
                yield* handle
                  .stage(
                    JSON.stringify({ id: installationID, originalPath: verified.target, deletedAt }, null, 2) + "\n",
                  )
                  .pipe(Effect.mapError((error) => safeMoveError(installationID, error)))
                yield* handle.move.pipe(Effect.mapError((error) => safeMoveError(installationID, error)))
                yield* handle.finalize.pipe(Effect.mapError((error) => safeMoveError(installationID, error)))
                if (!stateChanged) return
                yield* Ref.set(stateTouched, true)
                yield* writeStateForMutation(fs, file, disabled, "delete")
              }),
              rollbackRemoval(fs, handle, stateTouched, file, previous.content),
            )
            return yield* transaction.pipe(Effect.as(verified.target))
          }),
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof NotFoundError ||
            cause instanceof ProtectedError ||
            cause instanceof UnsafePathError ||
            (cause instanceof OperationError && cause.operation === "delete")
              ? cause
              : new OperationError({ operation: "delete", cause }),
          ),
        )
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof NotFoundError ||
          (cause instanceof OperationError && cause.operation === "delete") ||
          cause instanceof ProtectedError ||
          cause instanceof UnsafePathError
            ? cause
            : new OperationError({ operation: "delete", cause }),
        ),
      ),
    )
  })
}

export function project(entries: readonly Installed[], disabled: DisabledState, targets?: readonly DeletionTarget[]) {
  const identified = entries.map((entry) => ({ entry, id: id(entry) }))
  const active = new Map(
    identified
      .filter((item) => !isDisabled(item.entry, item.id, disabled))
      .map((item) => [item.entry.info.name, item.id]),
  )
  return identified.map((item, index) => {
    const isEnabled = !isDisabled(item.entry, item.id, disabled)
    return toInfo(
      item.entry,
      item.id,
      isEnabled ? (active.get(item.entry.info.name) === item.id ? "active" : "shadowed") : "disabled",
      targets?.[index],
    )
  })
}

export function effective(entries: readonly Installed[], disabled: DisabledState) {
  const skills = new Map<string, Skill.Info>()
  entries
    .map((entry) => ({ entry, id: id(entry) }))
    .filter((item) => !isDisabled(item.entry, item.id, disabled))
    .forEach((item) => skills.set(item.entry.info.name, item.entry.info))
  return Array.from(skills.values())
}

function readStateForMutation(fs: FSUtil.Interface, file: string) {
  return readStateRecord(fs, file).pipe(Effect.map((state) => state.disabled))
}

function updateStateUnlocked(fs: FSUtil.Interface, file: string, installationID: Skill.ManagementID, enabled: boolean) {
  return Effect.gen(function* () {
    const disabled = yield* readStateForMutation(fs, file)
    if (enabled) disabled.delete(installationID)
    if (!enabled) disabled.add(installationID)
    yield* writeStateForMutation(fs, file, disabled, "write")
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof OperationError && cause.operation === "write"
        ? cause
        : new OperationError({ operation: "write", cause }),
    ),
  )
}

function readStateRecord(fs: FSUtil.Interface, file: string) {
  return Effect.gen(function* () {
    const content = yield* fs.readFileString(file).pipe(
      Effect.map((content): string | undefined => content),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      Effect.mapError((cause) => new OperationError({ operation: "read", cause })),
    )
    if (content === undefined) return { content, disabled: new Set<Skill.ManagementID>() }
    const disabled = yield* decodeStateFile(content).pipe(
      Effect.map((state) => new Set(state.disabled)),
      Effect.catch(() => warn(file)),
    )
    return { content, disabled }
  })
}

function writeStateForMutation(
  fs: FSUtil.Interface,
  file: string,
  disabled: ReadonlySet<Skill.ManagementID>,
  operation: "write" | "delete",
) {
  return replaceState(
    fs,
    file,
    JSON.stringify({ version: 1, disabled: Array.from(disabled).toSorted() }, null, 2) + "\n",
  ).pipe(Effect.mapError((cause) => new OperationError({ operation, cause })))
}

function restoreState(fs: FSUtil.Interface, file: string, content: string | undefined) {
  if (content === undefined) return fs.remove(file, { force: true })
  return replaceState(fs, file, content)
}

function replaceState(fs: FSUtil.Interface, file: string, content: string) {
  const tempfile = `${file}.${process.pid}.${randomUUID()}.tmp`
  return Effect.gen(function* () {
    yield* fs.makeDirectory(path.dirname(file), { recursive: true })
    yield* fs.writeFileString(tempfile, content, { flag: "wx", mode: 0o600 })
    yield* fs.rename(tempfile, file)
  }).pipe(Effect.ensuring(fs.remove(tempfile, { force: true }).pipe(Effect.ignore)))
}

function withStateLock<A, R>(
  flock: EffectFlock.Interface,
  file: string,
  operation: "write" | "delete",
  body: Effect.Effect<A, OperationError | NotFoundError, R>,
): Effect.Effect<A, OperationError | NotFoundError, R> {
  return flock.withLock(body, file).pipe(
    Effect.catchCause((cause): Effect.Effect<never, OperationError | NotFoundError> => {
      if (Cause.hasInterrupts(cause)) return Effect.interrupt
      const error = Cause.squash(cause)
      if (!Cause.hasDies(cause) && error instanceof NotFoundError) return Effect.fail(error)
      return error instanceof OperationError && error.operation === operation && !Cause.hasDies(cause)
        ? Effect.fail(error)
        : Effect.fail(new OperationError({ operation, cause: error }))
    }),
  )
}

function withDeleteLock<R>(
  flock: EffectFlock.Interface,
  file: string,
  body: Effect.Effect<AbsolutePath, ManagementError, R>,
): Effect.Effect<AbsolutePath, ManagementError, R> {
  return Effect.gen(function* () {
    const committed = yield* Ref.make<AbsolutePath | undefined>(undefined)
    const tracked = Effect.uninterruptibleMask((restore) =>
      restore(body).pipe(Effect.flatMap((target) => Ref.set(committed, target).pipe(Effect.as(target)))),
    )
    return yield* flock.withLock(tracked, file).pipe(
      Effect.catchCause((cause) =>
        Ref.get(committed).pipe(
          Effect.flatMap((target) => {
            if (target !== undefined) return Effect.succeed(target)
            return normalizeDeleteCause(cause)
          }),
        ),
      ),
    )
  })
}

function normalizeDeleteCause(cause: Cause.Cause<unknown>): Effect.Effect<never, ManagementError> {
  if (Cause.hasInterrupts(cause)) return Effect.interrupt
  const error = Cause.squash(cause)
  if (
    !Cause.hasDies(cause) &&
    (error instanceof NotFoundError ||
      error instanceof ProtectedError ||
      error instanceof UnsafePathError ||
      (error instanceof OperationError && error.operation === "delete"))
  ) {
    return Effect.fail(error)
  }
  return Effect.fail(new OperationError({ operation: "delete", cause: error }))
}

function withCompensation<A, E, R, E2, R2>(
  action: Effect.Effect<A, E, R>,
  compensation: Effect.Effect<void, E2, R2>,
): Effect.Effect<A, E | OperationError, R | R2> {
  return Effect.uninterruptibleMask((restore) =>
    restore(action).pipe(
      Effect.catchCause((original) =>
        compensation.pipe(
          Effect.exit,
          Effect.flatMap((result) =>
            Exit.isSuccess(result)
              ? Effect.failCause(original as Cause.Cause<E | OperationError>)
              : Effect.fail<E | OperationError>(
                  new OperationError({ operation: "delete", cause: Cause.combine(original, result.cause) }),
                ),
          ),
        ),
      ),
    ),
  )
}

function safeMoveError(installationID: Skill.ManagementID, error: SkillSafeMove.SafeMoveError): ManagementError {
  if (error.reason === "not-found") return new NotFoundError({ id: installationID })
  if (error.reason === "unsafe" || error.reason === "unsupported") {
    return new UnsafePathError({ id: installationID, reason: "unsafe" })
  }
  return new OperationError({ operation: "delete", cause: error })
}

function rollbackRemoval(
  fs: FSUtil.Interface,
  handle: SkillSafeMove.Handle,
  stateTouched: Ref.Ref<boolean>,
  file: string,
  content: string | undefined,
) {
  return Effect.gen(function* () {
    const payload = yield* handle.rollback.pipe(Effect.exit)
    const state = (yield* Ref.get(stateTouched))
      ? yield* restoreState(fs, file, content).pipe(Effect.exit)
      : Exit.succeed(undefined)
    if (Exit.isFailure(payload) && Exit.isFailure(state)) {
      return yield* Effect.failCause(Cause.combine(payload.cause, state.cause))
    }
    if (Exit.isFailure(payload)) return yield* Effect.failCause(payload.cause)
    if (Exit.isFailure(state)) return yield* Effect.failCause(state.cause)
    return undefined
  })
}

function sameInstallation(left: Installed, right: Installed) {
  return (
    Skill.Source.equals(left.source, right.source) &&
    left.info.name === right.info.name &&
    left.info.location === right.info.location &&
    left.info.content === right.info.content &&
    left.info.description === right.info.description &&
    left.info.slash === right.info.slash
  )
}

function warn(file: string) {
  return Effect.logWarning("failed to read skill state", { path: file }).pipe(Effect.as(new Set<Skill.ManagementID>()))
}

function isDisabled(entry: Installed, installationID: Skill.ManagementID, disabled: DisabledState) {
  return disabled[scope(entry.source)].has(installationID)
}

function toInfo(
  entry: Installed,
  installationID: Skill.ManagementID,
  status: typeof Skill.ManagementStatus.Type,
  deletion?: DeletionTarget,
): Skill.ManagementInfo {
  const sourceInfo = source(entry.source)
  const fallback =
    sourceInfo.type === "builtin"
      ? ({ blocked: "builtin" } as const)
      : sourceInfo.type === "url"
        ? ({ blocked: "remote" } as const)
        : sourceInfo.type === "plugin"
          ? ({ blocked: "plugin" } as const)
          : ({ blocked: "unsafe" } as const)
  const target = deletion ?? fallback
  return {
    id: installationID,
    name: entry.info.name,
    description: entry.info.description,
    location: entry.info.location,
    source: sourceInfo,
    status,
    enabled: status !== "disabled",
    deletable: "target" in target,
    ...("target" in target ? { deleteTarget: target.target } : { deleteBlocked: target.blocked }),
  }
}

function source(input: Skill.Source): typeof Skill.ManagementSource.Type {
  if (!input.origin) {
    return {
      type: "plugin",
      scope: "project",
      value: input.type === "directory" ? input.path : input.type === "url" ? input.url : input.skill.name,
    }
  }
  if (input.origin.type === "plugin") {
    return {
      type: "plugin",
      scope: input.origin.scope,
      value:
        input.origin.value ??
        (input.type === "directory" ? input.path : input.type === "url" ? input.url : input.skill.name),
    }
  }
  if (input.origin.type === "builtin") {
    return {
      type: "builtin",
      scope: input.origin.scope,
      value: input.origin.value ?? (input.type === "embedded" ? input.skill.name : Skill.Source.key(input)),
    }
  }
  if (input.type === "directory") return { type: "directory", scope: input.origin.scope, value: input.path }
  if (input.type === "url") return { type: "url", scope: input.origin.scope, value: input.url }
  return { type: "plugin", scope: input.origin.scope, value: input.origin.value ?? input.skill.name }
}

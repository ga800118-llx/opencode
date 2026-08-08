import { randomUUID } from "crypto"
import path from "path"
import { Cause, Effect, Exit, Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { FSUtil } from "../fs-util"
import type { Global } from "../global"
import type { Location } from "../location"
import { Project } from "../project"
import { AbsolutePath } from "../schema"
import type { EffectFlock } from "../util/effect-flock"
import { Hash } from "../util/hash"

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
  reason: Schema.Literals(["builtin", "remote", "plugin"]),
}) {}

export class UnsafePathError extends Schema.TaggedErrorClass<UnsafePathError>()("SkillV2.UnsafePathError", {
  id: Skill.ManagementID,
}) {}

export type ManagementError = NotFoundError | OperationError | ProtectedError | UnsafePathError

export type DeletionTarget =
  | { readonly target: AbsolutePath }
  | { readonly blocked: typeof Skill.DeleteBlocked.Type }

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
  return readStateForMutation(fs, file).pipe(
    Effect.catch(() => warn(file)),
  )
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
    Effect.gen(function* () {
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
    ),
  )
}

export function deleteTarget(entry: Installed, fs: FSUtil.Interface): Effect.Effect<DeletionTarget> {
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
    const sourceReal = yield* fs.realPath(sourceRoot)
    const candidateReal = yield* fs.realPath(candidate)
    if (candidateReal === sourceReal || !FSUtil.contains(sourceReal, candidateReal)) return { blocked: "unsafe" as const }
    if (sourceReal !== sourceRoot || candidateReal !== candidate) return { blocked: "unsafe" as const }
    return { target: AbsolutePath.make(candidate) }
  }).pipe(Effect.catch(() => Effect.succeed({ blocked: "unsafe" as const })))
}

export function management(entries: readonly Installed[], disabled: DisabledState, fs: FSUtil.Interface) {
  return Effect.all(entries.map((entry) => deleteTarget(entry, fs))).pipe(
    Effect.map((targets) => project(entries, disabled, targets)),
  )
}

export function remove(
  fs: FSUtil.Interface,
  flock: EffectFlock.Interface,
  global: Global.Interface,
  file: string,
  entry: Installed,
) {
  const installationID = id(entry)
  return Effect.gen(function* () {
    const resolution = yield* deleteTarget(entry, fs)
    if ("blocked" in resolution) {
      if (resolution.blocked === "unsafe") return yield* new UnsafePathError({ id: installationID })
      return yield* new ProtectedError({ id: installationID, reason: resolution.blocked })
    }

    yield* withStateLock(
      flock,
      file,
      "delete",
      Effect.gen(function* () {
        const verified = yield* deleteTarget(entry, fs)
        if ("blocked" in verified) return yield* new OperationError({ operation: "delete" })

        const deletedAt = new Date().toISOString()
        const record = `${Date.now()}-${installationID.slice(0, 12)}-${randomUUID()}`
        const final = path.join(global.state, "skills", "trash", record)
        const staging = `${final}.staging`
        const transaction = Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(final), { recursive: true })
          yield* fs.makeDirectory(staging)
          yield* fs.writeFileString(
            path.join(staging, "metadata.json"),
            JSON.stringify({ id: installationID, originalPath: verified.target, deletedAt }, null, 2) + "\n",
            { flag: "wx", mode: 0o600 },
          )
          yield* fs.rename(verified.target, path.join(staging, "payload"))
          yield* fs.rename(staging, final)

          const disabled = yield* readStateForMutation(fs, file)
          if (!disabled.delete(installationID)) return
          yield* writeStateForMutation(fs, file, disabled, "delete")
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit) ? Effect.void : rollback(fs, verified.target, staging, final),
          ),
        )
        yield* transaction
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof OperationError && cause.operation === "delete"
            ? cause
            : new OperationError({ operation: "delete", cause }),
        ),
      ),
    )
    return resolution.target
  })
}

export function project(
  entries: readonly Installed[],
  disabled: DisabledState,
  targets?: readonly DeletionTarget[],
) {
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
  return Effect.gen(function* () {
    const content = yield* fs.readFileString(file).pipe(
      Effect.map((content): string | undefined => content),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      Effect.mapError((cause) => new OperationError({ operation: "read", cause })),
    )
    if (content === undefined) return new Set<Skill.ManagementID>()
    return yield* decodeStateFile(content).pipe(
      Effect.map((state) => new Set(state.disabled)),
      Effect.catch(() => warn(file)),
    )
  })
}

function writeStateForMutation(
  fs: FSUtil.Interface,
  file: string,
  disabled: ReadonlySet<Skill.ManagementID>,
  operation: "write" | "delete",
) {
  const tempfile = `${file}.${process.pid}.${randomUUID()}.tmp`
  return Effect.gen(function* () {
    yield* fs.makeDirectory(path.dirname(file), { recursive: true })
    yield* fs.writeFileString(
      tempfile,
      JSON.stringify({ version: 1, disabled: Array.from(disabled).toSorted() }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    )
    yield* fs.rename(tempfile, file)
  }).pipe(
    Effect.mapError((cause) => new OperationError({ operation, cause })),
    Effect.ensuring(fs.remove(tempfile, { force: true }).pipe(Effect.ignore)),
  )
}

function withStateLock<A, R>(
  flock: EffectFlock.Interface,
  file: string,
  operation: "write" | "delete",
  body: Effect.Effect<A, OperationError, R>,
) {
  return flock.withLock(body, file).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.interrupt
      const error = Cause.squash(cause)
      return error instanceof OperationError && error.operation === operation && !Cause.hasDies(cause)
        ? Effect.fail(error)
        : Effect.fail(new OperationError({ operation, cause: error }))
    }),
  )
}

function rollback(fs: FSUtil.Interface, target: AbsolutePath, staging: string, final: string) {
  return Effect.gen(function* () {
    const container = (yield* fs.exists(path.join(final, "payload")).pipe(Effect.orElseSucceed(() => false)))
      ? final
      : staging
    const payload = path.join(container, "payload")
    if (!(yield* fs.exists(payload).pipe(Effect.orElseSucceed(() => false)))) {
      yield* fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)
      return
    }
    yield* fs.rename(payload, target)
    yield* fs.remove(container, { recursive: true, force: true })
  }).pipe(Effect.ignore)
}

function warn(file: string) {
  return Effect.logWarning("failed to read skill state", { path: file }).pipe(
    Effect.as(new Set<Skill.ManagementID>()),
  )
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
        input.origin.value ?? (input.type === "directory" ? input.path : input.type === "url" ? input.url : input.skill.name),
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

import { randomUUID } from "crypto"
import path from "path"
import { Effect, Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import type { FSUtil } from "../fs-util"
import type { Global } from "../global"
import type { Location } from "../location"
import { Project } from "../project"
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
  operation: Schema.Literals(["read", "write"]),
  cause: Schema.optional(Schema.Defect()),
}) {}

export type ManagementError = NotFoundError | OperationError

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
  return flock
    .withLock(
      Effect.gen(function* () {
        const disabled = yield* readStateForMutation(fs, file)
        if (enabled) disabled.delete(installationID)
        if (!enabled) disabled.add(installationID)

        const tempfile = `${file}.${process.pid}.${randomUUID()}.tmp`
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(file), { recursive: true })
          yield* fs.writeFileString(
            tempfile,
            JSON.stringify({ version: 1, disabled: Array.from(disabled).toSorted() }, null, 2) + "\n",
            { flag: "wx", mode: 0o600 },
          )
          yield* fs.rename(tempfile, file)
        }).pipe(
          Effect.mapError((cause) => new OperationError({ operation: "write", cause })),
          Effect.ensuring(fs.remove(tempfile, { force: true }).pipe(Effect.ignore)),
        )
      }),
      file,
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof OperationError ? cause : new OperationError({ operation: "write", cause }),
      ),
    )
}

export function project(entries: readonly Installed[], disabled: DisabledState) {
  const identified = entries.map((entry) => ({ entry, id: id(entry) }))
  const active = new Map(
    identified
      .filter((item) => !isDisabled(item.entry, item.id, disabled))
      .map((item) => [item.entry.info.name, item.id]),
  )
  return identified.map((item) => {
    const isEnabled = !isDisabled(item.entry, item.id, disabled)
    return toInfo(
      item.entry,
      item.id,
      isEnabled ? (active.get(item.entry.info.name) === item.id ? "active" : "shadowed") : "disabled",
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
): Skill.ManagementInfo {
  const sourceInfo = source(entry.source)
  return {
    id: installationID,
    name: entry.info.name,
    description: entry.info.description,
    location: entry.info.location,
    source: sourceInfo,
    status,
    enabled: status !== "disabled",
    deletable: false,
    deleteBlocked:
      sourceInfo.type === "builtin"
        ? "builtin"
        : sourceInfo.type === "url"
          ? "remote"
          : sourceInfo.type === "plugin"
            ? "plugin"
            : "unsafe",
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

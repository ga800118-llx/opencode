export * as SkillV2 from "./skill"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Scope, Types } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { PermissionV2 } from "./permission"
import { AbsolutePath } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import {
  effective,
  id,
  management,
  NotFoundError,
  OperationError,
  ProtectedError,
  readState,
  remove,
  scope,
  statePaths,
  updateStateIfInstalled,
  UnsafePathError,
  type Installed,
  type ManagementError,
} from "./skill/management"
import { SkillSafeMove } from "./skill/safe-move"
import { State } from "./state"
import { EffectFlock } from "./util/effect-flock"
import { AppProcess } from "./process"
import { ChildProcess } from "effect/unstable/process"

export const DirectorySource = Skill.DirectorySource
export type DirectorySource = Skill.DirectorySource

export const UrlSource = Skill.UrlSource
export type UrlSource = Skill.UrlSource

export const EmbeddedSource = Skill.EmbeddedSource
export type EmbeddedSource = Skill.EmbeddedSource

export const Source = Skill.Source
export type Source = typeof Source.Type

export const Info = Skill.Info
export type Info = Skill.Info

export const ManagementID = Skill.ManagementID
export type ManagementID = Skill.ManagementID

export const ManagementStatus = Skill.ManagementStatus
export type ManagementStatus = typeof ManagementStatus.Type

export const ManagementSource = Skill.ManagementSource
export type ManagementSource = typeof ManagementSource.Type

export const ManagementInfo = Skill.ManagementInfo
export type ManagementInfo = Skill.ManagementInfo

export { NotFoundError, OperationError, ProtectedError, UnsafePathError }
export type { ManagementError }

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter((skill) => PermissionV2.evaluate("skill", skill.name, agent.permissions).effect !== "deny")

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)
const decodeSkillFiles = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))
const sourceScanTimeout = "2 seconds"
const sourceLoadTimeout = "3 seconds"
const maxScanOutputBytes = 4 * 1024 * 1024
const scanner = `
const fs = require("node:fs/promises")
const path = require("node:path")
const root = process.env.OPENCODE_SKILL_SOURCE
const files = []
const visited = new Set()

async function walk(directory, depth) {
  const real = await fs.realpath(directory)
  if (visited.has(real)) return
  visited.add(real)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === ".git") continue
    const filepath = path.join(directory, entry.name)
    const skill = (depth === 0 && entry.name.endsWith(".md")) || (depth > 0 && entry.name === "SKILL.md")
    if (entry.isFile()) {
      if (skill) files.push(filepath)
      continue
    }
    if (entry.isDirectory()) {
      await walk(filepath, depth + 1)
      continue
    }
    if (!entry.isSymbolicLink()) continue
    const stat = await fs.stat(filepath)
    if (stat.isDirectory()) await walk(filepath, depth + 1)
    if (stat.isFile() && skill) files.push(filepath)
  }
}

walk(root, 0)
  .then(() => process.stdout.write(JSON.stringify(files)))
  .catch((error) => {
    process.stderr.write(String(error))
    process.exitCode = 1
  })
`

export type Data = {
  sources: Types.DeepMutable<Source>[]
}

export type Draft = {
  source: (source: Source) => void
  list: () => readonly Source[]
}

export interface Interface extends State.Transformable<Draft> {
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: () => Effect.Effect<Info[]>
  readonly management: {
    readonly list: (refresh?: boolean) => Effect.Effect<ManagementInfo[]>
    readonly onRefresh?: (refresh: () => Effect.Effect<void>) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly setEnabled: (
      id: ManagementID,
      enabled: boolean,
    ) => Effect.Effect<ManagementInfo[], NotFoundError | OperationError>
    readonly remove: (id: ManagementID) => Effect.Effect<ManagementInfo[], ManagementError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const flock = yield* EffectFlock.Service
    const safeMove = yield* SkillSafeMove.Service
    const appProcess = yield* AppProcess.Service
    const cache = new Map<string, Info[]>()
    const managementRefreshes = new Set<() => Effect.Effect<void>>()

    const state = State.create<Data, Draft>({
      initial: () => ({ sources: [] }),
      draft: (draft) => ({
        source: (source) => {
          const index = draft.sources.findIndex((item) => Source.equals(item, source))
          if (index !== -1) {
            if (ownership(source) < ownership(draft.sources[index])) return
            draft.sources[index] = source as Types.DeepMutable<Source>
            return
          }
          draft.sources.push(source as Types.DeepMutable<Source>)
        },
        list: () => draft.sources as Source[],
      }),
      finalize: (draft) =>
        Effect.sync(() => {
          const active = new Set(draft.list().map(Source.key))
          cache.keys().forEach((key) => {
            if (!active.has(key)) cache.delete(key)
          })
        }),
    })

    // Filesystem providers can block inside directory enumeration. Keep that
    // work outside the server process so one unavailable source cannot freeze it.
    const scan = Effect.fn("SkillV2.scan")(function* (directory: string) {
      const result = yield* appProcess.run(
        ChildProcess.make(process.execPath, ["-e", scanner], {
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            OPENCODE_SKILL_SOURCE: directory,
          },
          extendEnv: true,
          stdin: "ignore",
          killSignal: "SIGKILL",
        }),
        {
          timeout: sourceScanTimeout,
          maxOutputBytes: maxScanOutputBytes,
          maxErrorBytes: 8 * 1024,
        },
      )
      if (result.exitCode !== 0 || result.stdoutTruncated) return []
      return yield* decodeSkillFiles(result.stdout.toString("utf8"))
    })

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") return [source.skill]
      const directories = source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      for (const directory of directories) {
        const files = yield* scan(directory).pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const filepath of files.toSorted()) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!content) continue
          const markdown = ConfigMarkdown.parseOption(content)
          if (!markdown) continue
          const frontmatter = decodeFrontmatter(markdown.data).valueOrUndefined
          if (!frontmatter) continue
          const name =
            frontmatter.name !== undefined
              ? frontmatter.name
              : path.dirname(filepath) === directory
                ? path.basename(filepath, ".md")
                : undefined
          if (!name) continue
          skills.push({
            name,
            description: frontmatter.description,
            slash: frontmatter.slash,
            location: AbsolutePath.make(filepath),
            content: markdown.content,
          })
        }
      }
      return skills
    })

    const installed = Effect.fn("SkillV2.installed")(function* (refresh = false) {
      if (refresh) cache.clear()
      const loaded = yield* Effect.forEach(
        state.get().sources,
        (source) => {
          const key = Source.key(source)
          const cached = cache.get(key)
          if (cached !== undefined) return Effect.succeed({ source, skills: cached })
          return load(source).pipe(
            Effect.timeout(sourceLoadTimeout),
            Effect.catch((cause) =>
              Effect.logWarning("Skipping unavailable skill source", {
                type: source.type,
                origin: source.origin?.type,
                cause: String(cause),
              }).pipe(Effect.as([] as Info[])),
            ),
            Effect.tap((skills) => Effect.sync(() => cache.set(key, skills))),
            Effect.map((skills) => ({ source, skills })),
          )
        },
        { concurrency: "unbounded" },
      )
      return loaded.flatMap((entry) => entry.skills.map((info) => ({ source: entry.source, info })))
    })
    const paths = statePaths(global, location)
    const disabled = Effect.fn("SkillV2.disabled")(function* () {
      const states = yield* Effect.all([readState(fs, paths.global), readState(fs, paths.project)])
      return { global: states[0], project: states[1] }
    })
    const list = Effect.fn("SkillV2.list")(function* () {
      return effective(yield* installed(), yield* disabled())
    })
    const managementSnapshot = Effect.fn("SkillV2.management.snapshot")(function* () {
      return yield* management(yield* installed(), yield* disabled(), fs, safeMove)
    })
    const managementList = Effect.fn("SkillV2.management.list")(function* (refresh = false) {
      yield* Effect.forEach(managementRefreshes, (reload) => reload(), { discard: true })
      yield* state.reload()
      if (!refresh) return yield* managementSnapshot()
      return yield* management(yield* installed(true), yield* disabled(), fs, safeMove)
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      sources: Effect.fn("SkillV2.sources")(function* () {
        return state.get().sources
      }),
      list,
      management: {
        list: managementList,
        onRefresh: Effect.fn("SkillV2.management.onRefresh")(function* (reload) {
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              managementRefreshes.add(reload)
              const dispose = Effect.sync(() => {
                managementRefreshes.delete(reload)
              })
              yield* Effect.addFinalizer(() => dispose)
              return { dispose }
            }),
          )
        }),
        setEnabled: Effect.fn("SkillV2.management.setEnabled")(function* (
          installationID: ManagementID,
          enabled: boolean,
        ) {
          const installation = (yield* installed()).find((entry) => id(entry) === installationID)
          if (!installation) return yield* new NotFoundError({ id: installationID })
          const expectedScope = scope(installation.source)
          yield* updateStateIfInstalled(fs, flock, paths[expectedScope], installationID, enabled, expectedScope, () =>
            installed(true),
          )
          return yield* managementSnapshot()
        }),
        remove: Effect.fn("SkillV2.management.remove")(function* (installationID: ManagementID) {
          const installation = (yield* installed()).find((entry) => id(entry) === installationID)
          if (!installation) return yield* new NotFoundError({ id: installationID })
          yield* remove(fs, safeMove, flock, global, paths[scope(installation.source)], installation, () =>
            installed(true),
          )
          cache.delete(Source.key(installation.source))
          return yield* managementSnapshot()
        }),
      },
    })
  }),
)

function ownership(source: Source) {
  if (!source.origin) return "0"
  const priority =
    source.origin.type === "external" || source.origin.type === "builtin"
      ? 4
      : source.origin.type === "config-file"
        ? 3
        : source.origin.type === "config-directory"
          ? 2
          : 1
  return `${priority}:${source.origin.scope}:${source.origin.type}:${source.origin.value ?? ""}`
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    SkillDiscovery.node,
    FSUtil.node,
    Global.node,
    Location.node,
    EffectFlock.node,
    SkillSafeMove.node,
    AppProcess.node,
  ],
})

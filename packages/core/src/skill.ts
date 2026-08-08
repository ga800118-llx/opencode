export * as SkillV2 from "./skill"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Types } from "effect"
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
    readonly list: () => Effect.Effect<ManagementInfo[]>
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

    const state = State.create<Data, Draft>({
      initial: () => ({ sources: [] }),
      draft: (draft) => ({
        source: (source) => {
          const index = draft.sources.findIndex((item) => Source.equals(item, source))
          if (index !== -1) {
            if (source.origin !== undefined) draft.sources[index] = source as Types.DeepMutable<Source>
            return
          }
          draft.sources.push(source as Types.DeepMutable<Source>)
        },
        list: () => draft.sources as Source[],
      }),
    })

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") return [source.skill]
      const directories = source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      for (const directory of directories) {
        const files = yield* fs
          .glob("{*.md,**/SKILL.md}", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
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

    // QUESTION(Dax): Should local skill sources invalidate on filesystem watch
    // events, following the reload policy chosen for other context sources?
    const cache = new Map<string, Info[]>()
    const installed = Effect.fn("SkillV2.installed")(function* () {
      const skills: Installed[] = []
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = source.type === "directory" ? yield* load(source) : (cache.get(key) ?? (yield* load(source)))
        if (source.type !== "directory") cache.set(key, loaded)
        skills.push(...loaded.map((info) => ({ source, info })))
      }
      return skills
    })
    const paths = statePaths(global, location)
    const disabled = Effect.fn("SkillV2.disabled")(function* () {
      const states = yield* Effect.all([readState(fs, paths.global), readState(fs, paths.project)])
      return { global: states[0], project: states[1] }
    })
    const list = Effect.fn("SkillV2.list")(function* () {
      return effective(yield* installed(), yield* disabled())
    })
    const managementList = Effect.fn("SkillV2.management.list")(function* () {
      return yield* management(yield* installed(), yield* disabled(), fs, safeMove)
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
        setEnabled: Effect.fn("SkillV2.management.setEnabled")(function* (
          installationID: ManagementID,
          enabled: boolean,
        ) {
          const installation = (yield* installed()).find((entry) => id(entry) === installationID)
          if (!installation) return yield* new NotFoundError({ id: installationID })
          const expectedScope = scope(installation.source)
          yield* updateStateIfInstalled(
            fs,
            flock,
            paths[expectedScope],
            installationID,
            enabled,
            expectedScope,
            installed,
          )
          return yield* managementList()
        }),
        remove: Effect.fn("SkillV2.management.remove")(function* (installationID: ManagementID) {
          const installation = (yield* installed()).find((entry) => id(entry) === installationID)
          if (!installation) return yield* new NotFoundError({ id: installationID })
          yield* remove(fs, safeMove, flock, global, paths[scope(installation.source)], installation, installed)
          cache.delete(Source.key(installation.source))
          return yield* managementList()
        }),
      },
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SkillDiscovery.node, FSUtil.node, Global.node, Location.node, EffectFlock.node, SkillSafeMove.node],
})

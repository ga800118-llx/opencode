export * as Skill from "./skill"

import { Schema } from "effect"
import { optional } from "./schema"
import { AbsolutePath } from "./schema"

export const Scope = Schema.Literals(["global", "project"]).annotate({ identifier: "SkillV2.Scope" })
export type Scope = typeof Scope.Type

export const SourceOrigin = Schema.Struct({
  scope: Scope,
  type: Schema.Literals(["builtin", "config-directory", "config-file", "external", "plugin"]),
  value: Schema.String.pipe(optional),
}).annotate({ identifier: "SkillV2.SourceOrigin" })
export interface SourceOrigin extends Schema.Schema.Type<typeof SourceOrigin> {}

export const ManagementID = Schema.String.pipe(Schema.brand("SkillV2.ManagementID"))
export type ManagementID = typeof ManagementID.Type

export const ManagementStatus = Schema.Literals(["active", "shadowed", "disabled"])
export const DeleteBlocked = Schema.Literals(["builtin", "remote", "plugin", "shared", "unsafe"])

export const ManagementSource = Schema.Struct({
  type: Schema.Literals(["builtin", "directory", "external", "url", "plugin"]),
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

export interface DirectorySource extends Schema.Schema.Type<typeof DirectorySource> {}
export const DirectorySource = Schema.Struct({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
  origin: SourceOrigin.pipe(optional),
}).annotate({ identifier: "SkillV2.DirectorySource" })

export interface UrlSource extends Schema.Schema.Type<typeof UrlSource> {}
export const UrlSource = Schema.Struct({
  type: Schema.Literal("url"),
  url: Schema.String,
  origin: SourceOrigin.pipe(optional),
}).annotate({ identifier: "SkillV2.UrlSource" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
  slash: Schema.Boolean.pipe(optional),
  location: AbsolutePath,
  content: Schema.String,
}).annotate({ identifier: "SkillV2.Info" })

export interface EmbeddedSource extends Schema.Schema.Type<typeof EmbeddedSource> {}
export const EmbeddedSource = Schema.Struct({
  type: Schema.Literal("embedded"),
  skill: Schema.suspend(() => Info),
  origin: SourceOrigin.pipe(optional),
}).annotate({ identifier: "SkillV2.EmbeddedSource" })

export type Source = DirectorySource | UrlSource | EmbeddedSource
export const Source = Object.assign(
  Schema.Union([DirectorySource, UrlSource, EmbeddedSource]).pipe(
    Schema.toTaggedUnion("type"),
    Schema.annotate({ identifier: "SkillV2.Source" }),
  ),
  {
    equals: (a: Source, b: Source) => {
      if (a.type !== b.type) return false
      if (a.type === "directory" && b.type === "directory") return a.path === b.path
      if (a.type === "url" && b.type === "url") return a.url === b.url
      if (a.type === "embedded" && b.type === "embedded") return a.skill.name === b.skill.name
      return false
    },
    key: (source: Source) =>
      source.type === "directory"
        ? `directory:${source.path}`
        : source.type === "url"
          ? `url:${source.url}`
          : `embedded:${source.skill.name}`,
  },
)

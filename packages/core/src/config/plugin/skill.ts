export * as ConfigSkillPlugin from "./skill"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect, Option } from "effect"
import { Config } from "../../config"
import { Flag } from "../../flag/flag"
import { FSUtil } from "../../fs-util"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { Global } from "../../global"
import { Location } from "../../location"

export const Plugin = define({
  id: "config-skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const skill = Option.getOrUndefined(yield* Effect.serviceOption(SkillV2.Service))
    const entries = { current: yield* config.entries(), generation: 0 }
    yield* ctx.skill.transform(
      Effect.fn(function* (draft) {
        const external = Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS
          ? []
          : [...(Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS ? [] : [".claude"]), ".agents"]
        for (const directory of external) {
          const source = path.join(global.home, directory, "skills")
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(source),
              origin: { scope: "global", type: "external", value: source },
            }),
          )
        }
        if (path.resolve(location.directory) !== path.resolve(global.config)) {
          const roots = yield* fs
            .up({ targets: external, start: location.directory, stop: location.project.directory })
            .pipe(Effect.catch(() => Effect.succeed([] as string[])))
          for (const root of roots) {
            const source = path.join(root, "skills")
            draft.source(
              SkillV2.DirectorySource.make({
                type: "directory",
                path: AbsolutePath.make(source),
                origin: { scope: "project", type: "external", value: source },
              }),
            )
          }
        }

        const directories = entries.current.filter((entry): entry is Config.Directory => entry.type === "directory")
        const files = entries.current.filter((entry): entry is Config.Document => entry.type === "document")
        for (const directory of directories) {
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.join(directory.path, "skill")),
              origin: { scope: scope(global.config, directory.path), type: "config-directory", value: directory.path },
            }),
          )
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.join(directory.path, "skills")),
              origin: { scope: scope(global.config, directory.path), type: "config-directory", value: directory.path },
            }),
          )
        }
        if (path.resolve(location.directory) !== path.resolve(global.config)) {
          const projectConfigs = projectSkillDirectories(location).map((directory) => path.join(directory, ".opencode"))
          for (const projectConfig of projectConfigs) {
            for (const directory of ["skill", "skills"]) {
              draft.source(
                SkillV2.DirectorySource.make({
                  type: "directory",
                  path: AbsolutePath.make(path.join(projectConfig, directory)),
                  origin: { scope: "project", type: "config-directory", value: projectConfig },
                }),
              )
            }
          }
        }
        for (const file of files) {
          for (const item of file.info.skills ?? []) {
            const origin = { scope: scope(global.config, file.path), type: "config-file" as const, value: file.path }
            if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
              draft.source(SkillV2.UrlSource.make({ type: "url", url: item, origin }))
              continue
            }
            const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
            draft.source(
              SkillV2.DirectorySource.make({
                type: "directory",
                path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
                origin,
              }),
            )
          }
        }
      }),
    )
    if (skill?.management.onRefresh) {
      yield* skill.management.onRefresh(
        Effect.fn(function* () {
          const generation = ++entries.generation
          const refreshed = yield* config.reloadEntries?.() ?? config.entries()
          if (generation === entries.generation) entries.current = refreshed
        }),
      )
    }
  }),
})

function projectSkillDirectories(location: Location.Interface) {
  const directory = path.resolve(location.directory)
  if (location.vcs?.type !== "git") return [directory]
  const root = path.resolve(location.project.directory)
  const relative = path.relative(root, directory)
  if (relative === "") return [root]
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return [...new Set([root, directory])]
  }
  const segments = relative.split(path.sep)
  return Array.from({ length: segments.length + 1 }, (_, index) => path.join(root, ...segments.slice(0, index)))
}

function scope(globalConfig: string, entryPath: string | undefined) {
  if (!entryPath) return "project" as const
  const relative = path.relative(globalConfig, entryPath)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return "project" as const
  return "global" as const
}

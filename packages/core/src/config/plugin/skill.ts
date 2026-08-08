export * as ConfigSkillPlugin from "./skill"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect } from "effect"
import { Config } from "../../config"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { Global } from "../../global"
import { Location } from "../../location"

export const Plugin = define({
  id: "config-skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    yield* ctx.skill.transform(
      Effect.fn(function* (draft) {
        const entries = yield* config.entries()
        const directories = entries.filter((entry): entry is Config.Directory => entry.type === "directory")
        const files = entries.filter((entry): entry is Config.Document => entry.type === "document")
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
  }),
})

function scope(globalConfig: string, entryPath: string | undefined) {
  if (!entryPath) return "project" as const
  const relative = path.relative(globalConfig, entryPath)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return "project" as const
  return "global" as const
}

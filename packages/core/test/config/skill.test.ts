import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(Layer.empty)
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigSkillPlugin.Plugin", () => {
  it.effect("registers configured skill directories and URLs", () =>
    Effect.gen(function* () {
      const directory = AbsolutePath.make("/repo/packages/app")
      const globalConfig = AbsolutePath.make("/home/test/.config/opencode")
      const sources: SkillV2.Source[] = []
      const transform = Effect.fnUntraced(function* (update: (draft: SkillV2.Draft) => void | Effect.Effect<void>) {
        const result = update({
          source: (source) => {
            sources.push(source)
          },
          list: () => sources,
        })
        if (Effect.isEffect(result)) yield* result
        const dispose = Effect.sync(() => {
          sources.length = 0
        })
        yield* Effect.addFinalizer(() => dispose)
        return { dispose }
      })

      yield* ConfigSkillPlugin.Plugin.effect(
        host({
          skill: { transform, reload: () => Effect.void },
        }),
      ).pipe(
        Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: "/home/test", config: globalConfig })),
        Effect.provideService(Location.Service, Location.Service.of(location({ directory }))),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Directory({ type: "directory", path: globalConfig }),
                new Config.Directory({ type: "directory", path: AbsolutePath.make(path.join(globalConfig, "..skills")) }),
                new Config.Directory({ type: "directory", path: AbsolutePath.make("/home/test/.config/opencode-backup") }),
                new Config.Directory({ type: "directory", path: AbsolutePath.make("/repo/.opencode") }),
                new Config.Document({
                  type: "document",
                  path: "/home/test/.config/opencode/opencode.json",
                  info: decode({
                    skills: ["./global-skills", "https://example.test/global-skills/"],
                  }),
                }),
                new Config.Document({
                  type: "document",
                  path: "/repo/opencode.json",
                  info: decode({
                    skills: ["./project-skills", "~/shared-skills", "/opt/skills", "https://example.test/project-skills/"],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(sources).toEqual([
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(globalConfig, "skill")),
          origin: { scope: "global", type: "config-directory", value: globalConfig },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(globalConfig, "skills")),
          origin: { scope: "global", type: "config-directory", value: globalConfig },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(globalConfig, "..skills", "skill")),
          origin: { scope: "global", type: "config-directory", value: path.join(globalConfig, "..skills") },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(globalConfig, "..skills", "skills")),
          origin: { scope: "global", type: "config-directory", value: path.join(globalConfig, "..skills") },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/home/test/.config/opencode-backup/skill"),
          origin: { scope: "project", type: "config-directory", value: "/home/test/.config/opencode-backup" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/home/test/.config/opencode-backup/skills"),
          origin: { scope: "project", type: "config-directory", value: "/home/test/.config/opencode-backup" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.opencode", "skill")),
          origin: { scope: "project", type: "config-directory", value: "/repo/.opencode" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.opencode", "skills")),
          origin: { scope: "project", type: "config-directory", value: "/repo/.opencode" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(directory, "global-skills")),
          origin: { scope: "global", type: "config-file", value: "/home/test/.config/opencode/opencode.json" },
        }),
        SkillV2.UrlSource.make({
          type: "url",
          url: "https://example.test/global-skills/",
          origin: { scope: "global", type: "config-file", value: "/home/test/.config/opencode/opencode.json" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(directory, "project-skills")),
          origin: { scope: "project", type: "config-file", value: "/repo/opencode.json" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/home/test", "shared-skills")),
          origin: { scope: "project", type: "config-file", value: "/repo/opencode.json" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/opt/skills"),
          origin: { scope: "project", type: "config-file", value: "/repo/opencode.json" },
        }),
        SkillV2.UrlSource.make({
          type: "url",
          url: "https://example.test/project-skills/",
          origin: { scope: "project", type: "config-file", value: "/repo/opencode.json" },
        }),
      ])
    }),
  )
})

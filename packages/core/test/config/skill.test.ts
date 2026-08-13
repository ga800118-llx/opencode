import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { Policy } from "@opencode-ai/core/policy"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { SkillSafeMove } from "@opencode-ai/core/skill/safe-move"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(Layer.empty)
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigSkillPlugin.Plugin", () => {
  it.live("does not let an older concurrent refresh replace a newer Skill snapshot", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const home = path.join(tmp.path, "home")
          const globalConfig = AbsolutePath.make(path.join(home, ".config", "opencode"))
          const projectRoot = AbsolutePath.make(path.join(tmp.path, "repo"))
          const stale = AbsolutePath.make(path.join(tmp.path, "stale"))
          const fresh = AbsolutePath.make(path.join(tmp.path, "fresh"))
          const firstLoaded = yield* Deferred.make<void>()
          const releaseFirst = yield* Deferred.make<void>()
          const secondLoaded = yield* Deferred.make<void>()
          const thirdLoaded = yield* Deferred.make<void>()
          const releaseThird = yield* Deferred.make<void>()
          const fourthLoaded = yield* Deferred.make<void>()
          let reloads = 0
          const document = (skill: AbsolutePath) =>
            new Config.Document({
              type: "document",
              path: path.join(projectRoot, "opencode.json"),
              info: decode({ skills: [skill] }),
            })
          const layer = AppNodeBuilder.build(
            LayerNode.group([SkillV2.node, Config.node, FSUtil.node, Global.node, Location.node]),
            [
              [
                Config.node,
                Layer.succeed(
                  Config.Service,
                  Config.Service.of({
                    entries: () => Effect.succeed([]),
                    reloadEntries: Effect.fnUntraced(function* () {
                      const reload = ++reloads
                      if (reload === 1) {
                        yield* Deferred.succeed(firstLoaded, undefined)
                        yield* Deferred.await(releaseFirst)
                        return [document(stale)]
                      }
                      if (reload === 2) {
                        yield* Deferred.succeed(secondLoaded, undefined)
                        return [document(fresh)]
                      }
                      if (reload === 3) {
                        yield* Deferred.succeed(thirdLoaded, undefined)
                        yield* Deferred.await(releaseThird)
                        return [document(stale)]
                      }
                      yield* Deferred.succeed(fourthLoaded, undefined)
                      return yield* Effect.die("refresh failed")
                    }),
                  }),
                ),
              ],
              [Global.node, Global.layerWith({ home, config: globalConfig, state: path.join(tmp.path, "state") })],
              [
                Location.node,
                Layer.succeed(
                  Location.Service,
                  Location.Service.of({
                    directory: AbsolutePath.make(projectRoot),
                    project: { id: Project.ID.make("config-skill-refresh-race"), directory: projectRoot },
                  }),
                ),
              ],
              [
                SkillDiscovery.node,
                Layer.succeed(SkillDiscovery.Service, SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) })),
              ],
              [
                SkillSafeMove.node,
                Layer.succeed(
                  SkillSafeMove.Service,
                  SkillSafeMove.Service.of({
                    available: () => Effect.succeed(false),
                    prepare: () => Effect.die("unused SkillSafeMove.prepare"),
                  }),
                ),
              ],
            ],
          )

          yield* Effect.gen(function* () {
            const skill = yield* SkillV2.Service
            yield* ConfigSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

            const first = yield* skill.management.list().pipe(Effect.forkScoped)
            yield* Deferred.await(firstLoaded)
            const second = yield* skill.management.list().pipe(Effect.forkScoped)
            yield* Deferred.await(secondLoaded)
            yield* Fiber.join(second)
            yield* Deferred.succeed(releaseFirst, undefined)
            yield* Fiber.join(first)

            expect(
              (yield* skill.sources())
                .filter((source) => source.origin?.type === "config-file")
                .map((source) => source.type === "directory" && source.path),
            ).toEqual([fresh])

            const third = yield* skill.management.list().pipe(Effect.forkScoped)
            yield* Deferred.await(thirdLoaded)
            const fourth = yield* skill.management.list().pipe(Effect.exit, Effect.forkScoped)
            yield* Deferred.await(fourthLoaded)
            expect(Exit.isFailure(yield* Fiber.join(fourth))).toBe(true)
            yield* Deferred.succeed(releaseThird, undefined)
            yield* Fiber.join(third)

            expect(
              (yield* skill.sources())
                .filter((source) => source.origin?.type === "config-file")
                .map((source) => source.type === "directory" && source.path),
            ).toEqual([fresh])
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )

  it.live("exposes Skills created after startup through the real management refresh", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const home = path.join(tmp.path, "home")
        const globalConfig = AbsolutePath.make(path.join(home, ".config", "opencode"))
        const projectRoot = AbsolutePath.make(path.join(tmp.path, "repo"))
        const directory = AbsolutePath.make(path.join(projectRoot, "packages", "app"))
        const configured = AbsolutePath.make(path.join(tmp.path, "configured-skills"))
        const configuredRemote = AbsolutePath.make(path.join(tmp.path, "configured-remote-skills"))
        const configuredRemoteURL = "https://example.test/configured-skills/"
        let configuredRemotePulls = 0
        const currentGlobal = Global.Service.of(
          Global.make({ home, config: globalConfig, state: path.join(tmp.path, "state") }),
        )
        const currentLocation = Location.Service.of({
          directory,
          project: { id: Project.ID.make("config-skill-refresh"), directory: projectRoot },
          vcs: { type: "git", store: AbsolutePath.make(path.join(projectRoot, ".git")) },
        })
        const layer = AppNodeBuilder.build(
          LayerNode.group([SkillV2.node, Config.node, Policy.node, FSUtil.node, Global.node, Location.node]),
          [
            [Global.node, Layer.succeed(Global.Service, currentGlobal)],
            [Location.node, Layer.succeed(Location.Service, currentLocation)],
            [
              SkillDiscovery.node,
              Layer.succeed(
                SkillDiscovery.Service,
                SkillDiscovery.Service.of({
                  pull: (url) =>
                    Effect.sync(() => {
                      if (url !== configuredRemoteURL) return [] as AbsolutePath[]
                      configuredRemotePulls++
                      return [configuredRemote]
                    }),
                }),
              ),
            ],
            [
              SkillSafeMove.node,
              Layer.succeed(
                SkillSafeMove.Service,
                SkillSafeMove.Service.of({
                  available: () => Effect.succeed(false),
                  prepare: () => Effect.die("unused SkillSafeMove.prepare"),
                }),
              ),
            ],
          ],
        )

        const write = (root: string, name: string) =>
          fs
            .mkdir(path.join(root, name), { recursive: true })
            .then(() =>
              fs.writeFile(
                path.join(root, name, "SKILL.md"),
                `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}`,
              ),
            )

        return Effect.promise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await fs.mkdir(globalConfig, { recursive: true })
          await fs.writeFile(path.join(projectRoot, "opencode.json"), JSON.stringify({ skills: [] }))
        }).pipe(
          Effect.flatMap(() =>
            Effect.gen(function* () {
              const skill = yield* SkillV2.Service
              yield* ConfigSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

              expect(yield* skill.management.list()).toEqual([])
              expect(
                (yield* skill.sources()).some(
                  (source) =>
                    source.type === "directory" &&
                    source.path === path.join(projectRoot, "packages", ".agents", "skills"),
                ),
              ).toBe(false)

              yield* Effect.promise(() =>
                Promise.all([
                  write(path.join(globalConfig, "skills"), "global-config"),
                  write(path.join(projectRoot, "packages", ".opencode", "skills"), "project-ancestor"),
                  write(path.join(home, ".agents", "skills"), "global-external"),
                  write(path.join(projectRoot, "packages", ".agents", "skills"), "project-external"),
                  write(configured, "configured-external"),
                  write(configuredRemote, "configured-remote"),
                  fs.writeFile(
                    path.join(projectRoot, "opencode.json"),
                    JSON.stringify({ skills: [configured, configuredRemoteURL] }),
                  ),
                ]),
              )

              const managed = Object.fromEntries((yield* skill.management.list()).map((item) => [item.name, item]))
              expect(Object.keys(managed).toSorted()).toEqual([
                "configured-external",
                "configured-remote",
                "global-config",
                "global-external",
                "project-ancestor",
                "project-external",
              ])
              expect(managed["global-config"]).toMatchObject({
                source: { type: "directory", scope: "global", value: path.join(globalConfig, "skills") },
              })
              expect(managed["project-ancestor"]).toMatchObject({
                source: {
                  type: "directory",
                  scope: "project",
                  value: path.join(projectRoot, "packages", ".opencode", "skills"),
                },
              })
              expect(managed["global-external"]).toMatchObject({
                source: { type: "external", scope: "global", value: path.join(home, ".agents", "skills") },
              })
              expect(managed["project-external"]).toMatchObject({
                source: {
                  type: "external",
                  scope: "project",
                  value: path.join(projectRoot, "packages", ".agents", "skills"),
                },
              })
              expect(managed["configured-external"]).toMatchObject({
                source: { type: "directory", scope: "project", value: configured },
              })
              expect(managed["configured-remote"]).toMatchObject({
                source: { type: "url", scope: "project", value: configuredRemoteURL },
              })
              expect(configuredRemotePulls).toBe(1)

              yield* Effect.promise(() =>
                fs.writeFile(path.join(projectRoot, "opencode.json"), JSON.stringify({ skills: [] })),
              )
              const removed = yield* skill.management.list()
              expect(removed.some((item) => item.name === "configured-external")).toBe(false)
              expect(removed.some((item) => item.name === "configured-remote")).toBe(false)

              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(projectRoot, "opencode.json"),
                  JSON.stringify({ skills: [configuredRemoteURL] }),
                ),
              )
              expect((yield* skill.management.list()).some((item) => item.name === "configured-remote")).toBe(true)
              expect(configuredRemotePulls).toBe(2)
            }).pipe(Effect.provide(layer)),
          ),
        )
      }),
    ),
  )

  it.effect("registers configured sources and the standard project Skill directories before they exist", () =>
    Effect.gen(function* () {
      const directory = AbsolutePath.make("/repo/packages/app")
      const projectRoot = AbsolutePath.make("/repo")
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

      const filesystem = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: () => Effect.succeed(["/repo/packages/app/.claude", "/repo/.agents"]),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

      yield* ConfigSkillPlugin.Plugin.effect(
        host({
          skill: { transform, reload: () => Effect.void },
        }),
      ).pipe(
        Effect.provideService(
          Global.Service,
          Global.Service.of({ ...Global.make(), home: "/home/test", config: globalConfig }),
        ),
        Effect.provideService(
          Location.Service,
          Location.Service.of(
            location(
              { directory },
              { projectDirectory: projectRoot, vcs: { type: "git", store: AbsolutePath.make("/repo/.git") } },
            ),
          ),
        ),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Directory({ type: "directory", path: globalConfig }),
                new Config.Directory({
                  type: "directory",
                  path: AbsolutePath.make(path.join(globalConfig, "..skills")),
                }),
                new Config.Directory({
                  type: "directory",
                  path: AbsolutePath.make("/home/test/.config/opencode-backup"),
                }),
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
                    skills: [
                      "./project-skills",
                      "~/shared-skills",
                      "/opt/skills",
                      "https://example.test/project-skills/",
                    ],
                  }),
                }),
              ]),
          }),
        ),
        Effect.provide(filesystem),
      )

      expect(sources).toEqual([
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/home/test/.claude/skills"),
          origin: { scope: "global", type: "external", value: "/home/test/.claude/skills" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/home/test/.agents/skills"),
          origin: { scope: "global", type: "external", value: "/home/test/.agents/skills" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/repo/packages/app/.claude/skills"),
          origin: { scope: "project", type: "external", value: "/repo/packages/app/.claude/skills" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/repo/.agents/skills"),
          origin: { scope: "project", type: "external", value: "/repo/.agents/skills" },
        }),
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
          path: AbsolutePath.make("/repo/packages/.opencode/skill"),
          origin: { scope: "project", type: "config-directory", value: "/repo/packages/.opencode" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make("/repo/packages/.opencode/skills"),
          origin: { scope: "project", type: "config-directory", value: "/repo/packages/.opencode" },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(directory, ".opencode", "skill")),
          origin: {
            scope: "project",
            type: "config-directory",
            value: path.join(directory, ".opencode"),
          },
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join(directory, ".opencode", "skills")),
          origin: {
            scope: "project",
            type: "config-directory",
            value: path.join(directory, ".opencode"),
          },
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

  it.effect("does not register project Skill directories for the global config location", () =>
    Effect.gen(function* () {
      const globalConfig = AbsolutePath.make("/home/test/.config/opencode")
      const sources: SkillV2.Source[] = []
      const transform = Effect.fnUntraced(function* (update: (draft: SkillV2.Draft) => void | Effect.Effect<void>) {
        const result = update({
          source: (source) => sources.push(source),
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
        Effect.provideService(
          Global.Service,
          Global.Service.of({ ...Global.make(), home: "/home/test", config: globalConfig }),
        ),
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: globalConfig }, { projectDirectory: globalConfig })),
        ),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () => Effect.succeed([new Config.Directory({ type: "directory", path: globalConfig })]),
          }),
        ),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      )

      expect(sources.every((source) => source.origin?.scope === "global")).toBe(true)
      expect(sources.some((source) => source.origin?.value === path.join(globalConfig, ".opencode"))).toBe(false)
    }),
  )

  it.effect("registers only the opened standard Skill directories for a non-Git location", () =>
    Effect.gen(function* () {
      const directory = AbsolutePath.make("/workspace/non-git")
      const globalConfig = AbsolutePath.make("/home/test/.config/opencode")
      const sources: SkillV2.Source[] = []
      const transform = Effect.fnUntraced(function* (update: (draft: SkillV2.Draft) => void | Effect.Effect<void>) {
        const result = update({
          source: (source) => sources.push(source),
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
        Effect.provideService(
          Global.Service,
          Global.Service.of({ ...Global.make(), home: "/home/test", config: globalConfig }),
        ),
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: AbsolutePath.make("/") })),
        ),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () => Effect.succeed([new Config.Directory({ type: "directory", path: globalConfig })]),
          }),
        ),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      )

      const standard = sources.filter((source) => source.origin?.type === "config-directory")
      expect(standard.map((source) => source.origin?.value)).toEqual([
        globalConfig,
        globalConfig,
        path.join(directory, ".opencode"),
        path.join(directory, ".opencode"),
      ])
      expect(standard.some((source) => source.origin?.value === "/.opencode")).toBe(false)
    }),
  )
})

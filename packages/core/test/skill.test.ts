import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { project, type Installed } from "@opencode-ai/core/skill/management"
import { Hash } from "@opencode-ai/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const urls = new Map<string, AbsolutePath[]>()
let pulls = 0
const discovery = Layer.succeed(
  SkillDiscovery.Service,
  SkillDiscovery.Service.of({
    pull: (url) => {
      pulls++
      return Effect.succeed(urls.get(url) ?? [])
    },
  }),
)
const testServices = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.map((tmp) =>
      AppNodeBuilder.build(LayerNode.group([SkillV2.node, AgentV2.node]), [
        [SkillDiscovery.node, discovery],
        [Global.node, Global.layerWith({ state: path.join(tmp.path, "state") })],
        [
          Location.node,
          Layer.succeed(
            Location.Service,
            Location.Service.of({
              directory: AbsolutePath.make(tmp.path),
              project: { id: Project.ID.global, directory: AbsolutePath.make(tmp.path) },
            }),
          ),
        ],
      ]),
    ),
  ),
)
const it = testEffect(testServices)

type SkillLayerInput = {
  state: string
  directory: string
  projectID: Project.ID
  projectRoot: string
}

function skillLayer(input: SkillLayerInput) {
  return Layer.fresh(
    AppNodeBuilder.build(SkillV2.node, [
      [SkillDiscovery.node, discovery],
      [Global.node, Global.layerWith({ state: input.state })],
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory: AbsolutePath.make(input.directory),
            project: { id: input.projectID, directory: AbsolutePath.make(input.projectRoot) },
          }),
        ),
      ],
    ]),
  )
}

function runSkill(
  input: SkillLayerInput,
  sources: readonly SkillV2.Source[],
  operation?: { id: SkillV2.ManagementID; enabled: boolean },
) {
  return Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    yield* skill.transform((editor) => sources.forEach((source) => editor.source(source)))
    if (operation) yield* skill.management.setEnabled(operation.id, operation.enabled)
    return {
      management: yield* skill.management.list(),
      effective: yield* skill.list(),
    }
  }).pipe(Effect.provide(skillLayer(input)))
}

function embedded(name: string, scope: "global" | "project", value: string) {
  return SkillV2.EmbeddedSource.make({
    type: "embedded",
    skill: SkillV2.Info.make({
      name,
      location: AbsolutePath.make(`/skills/${value}/${name}.md`),
      content: value,
    }),
    origin: { type: "builtin", scope, value },
  })
}

function stateFile(input: SkillLayerInput, scope: "global" | "project") {
  if (scope === "global") return path.join(input.state, "skills", "global.json")
  const key = Hash.sha256(
    input.projectID === Project.ID.global
      ? [input.projectID, input.projectRoot, input.directory].join("\0")
      : [input.projectID, input.projectRoot].join("\0"),
  )
  return path.join(input.state, "skills", "projects", `${key}.json`)
}

function write(directory: string, name: string, description: string) {
  return fs.writeFile(
    path.join(directory, name, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---
# ${name}`,
  )
}

describe("SkillV2", () => {
  it.live("projects built-in, configured, and plugin-owned management sources", () =>
    Effect.sync(() => {
      const builtin = SkillV2.Info.make({
        name: "builtin",
        location: AbsolutePath.make("/builtin/builtin.md"),
        content: "Builtin",
      })
      const directory = SkillV2.Info.make({
        name: "directory",
        location: AbsolutePath.make("/repo/.opencode/skills/directory/SKILL.md"),
        content: "Directory",
      })
      const url = SkillV2.Info.make({
        name: "url",
        location: AbsolutePath.make("/cache/skills/url/SKILL.md"),
        content: "URL",
      })
      const plugin = SkillV2.Info.make({
        name: "plugin",
        location: AbsolutePath.make("/plugins/example/skills/plugin/SKILL.md"),
        content: "Plugin",
      })
      const entries: Installed[] = [
        {
          source: SkillV2.EmbeddedSource.make({
            type: "embedded",
            skill: builtin,
            origin: { scope: "global", type: "builtin", value: "builtin" },
          }),
          info: builtin,
        },
        {
          source: SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make("/repo/.opencode/skills"),
            origin: { scope: "project", type: "config-directory", value: "/repo/.opencode" },
          }),
          info: directory,
        },
        {
          source: SkillV2.UrlSource.make({
            type: "url",
            url: "https://example.test/skills/",
            origin: { scope: "global", type: "config-file", value: "/home/user/.config/opencode.json" },
          }),
          info: url,
        },
        {
          source: SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make("/plugins/example/skills"),
            origin: { scope: "project", type: "plugin", value: "example-plugin" },
          }),
          info: plugin,
        },
      ]

      const managed = project(entries, { global: new Set(), project: new Set() })
      expect(managed.map((item) => ({ deleteBlocked: item.deleteBlocked, source: item.source }))).toEqual([
        { deleteBlocked: "builtin", source: { type: "builtin", scope: "global", value: "builtin" } },
        {
          deleteBlocked: "unsafe",
          source: { type: "directory", scope: "project", value: AbsolutePath.make("/repo/.opencode/skills") },
        },
        {
          deleteBlocked: "remote",
          source: { type: "url", scope: "global", value: "https://example.test/skills/" },
        },
        { deleteBlocked: "plugin", source: { type: "plugin", scope: "project", value: "example-plugin" } },
      ])
      expect(managed.every((item) => !("content" in item))).toBe(true)
    }),
  )

  it.live("retains source origin metadata", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* skill.transform((editor) =>
        editor.source(
          SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make("/repo/.opencode/skills"),
            origin: {
              scope: "project",
              type: "config-directory",
              value: "/repo/.opencode",
            },
          }),
        ),
      )
      expect(yield* skill.sources()).toContainEqual({
        type: "directory",
        path: AbsolutePath.make("/repo/.opencode/skills"),
        origin: { scope: "project", type: "config-directory", value: "/repo/.opencode" },
      })
    }),
  )

  it.live("retains later source origin metadata without changing source position", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      const first = AbsolutePath.make("/repo/first")
      const duplicate = AbsolutePath.make("/repo/duplicate")
      yield* skill.transform((editor) => {
        editor.source({ type: "directory", path: first })
        editor.source({ type: "directory", path: duplicate })
        editor.source(
          SkillV2.DirectorySource.make({
            type: "directory",
            path: first,
            origin: { scope: "project", type: "config-file", value: "/repo/opencode.json" },
          }),
        )
        editor.source({ type: "directory", path: first })
      })

      expect(yield* skill.sources()).toEqual([
        {
          type: "directory",
          path: first,
          origin: { scope: "project", type: "config-file", value: "/repo/opencode.json" },
        },
        { type: "directory", path: duplicate },
      ])
    }),
  )

  it.live("registers sources and resolves later source precedence", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "review", "Second")
            await fs.writeFile(path.join(first, "foo.md"), "---\nslash: true\n---\n# foo")
          })

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => {
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(second) })
            expect(editor.list()).toEqual([
              { type: "directory", path: AbsolutePath.make(first) },
              { type: "directory", path: AbsolutePath.make(second) },
            ])
          })

          expect(yield* skill.sources()).toEqual([
            { type: "directory", path: AbsolutePath.make(first) },
            { type: "directory", path: AbsolutePath.make(second) },
          ])
          const managed = yield* skill.management.list()
          expect(managed.map((item) => ({ description: item.description, name: item.name, status: item.status }))).toEqual([
            { description: undefined, name: "foo", status: "active" },
            { description: "First", name: "review", status: "shadowed" },
            { description: "Second", name: "review", status: "active" },
          ])
          expect(managed.every((item) => !("content" in item))).toBe(true)
          expect(managed.map((item) => item.id)).toEqual((yield* skill.management.list()).map((item) => item.id))
          expect(new Set(managed.map((item) => item.id)).size).toBe(3)
          expect(yield* skill.list()).toEqual([
            SkillV2.Info.make({
              name: "foo",
              slash: true,
              location: AbsolutePath.make(path.join(first, "foo.md")),
              content: "# foo",
            }),
            {
              name: "review",
              description: "Second",
              location: AbsolutePath.make(path.join(second, "review", "SKILL.md")),
              content: "# review",
            },
          ])
        }),
      ),
    ),
  )

  it.live("disables the active duplicate and re-enables it with original precedence", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "review", "Second")
          })
          const sources = [
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(first),
              origin: { type: "config-directory", scope: "project", value: first },
            }),
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(second),
              origin: { type: "config-directory", scope: "global", value: second },
            }),
          ]
          const initial = yield* runSkill(input, sources)
          const active = initial.management.find((item) => item.status === "active")!

          const disabled = yield* runSkill(input, sources, { id: active.id, enabled: false })
          expect(disabled.management.map((item) => item.status)).toEqual(["active", "disabled"])
          expect(disabled.effective.map((item) => item.description)).toEqual(["First"])
          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(input, "global"), "utf8")))).toEqual({
            version: 1,
            disabled: [active.id],
          })

          const enabled = yield* runSkill(input, sources, { id: active.id, enabled: true })
          expect(enabled.management.map((item) => item.status)).toEqual(["shadowed", "active"])
          expect(enabled.effective.map((item) => item.description)).toEqual(["Second"])
        }),
      ),
    ),
  )

  it.live("persists sorted global and project state across fresh services", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo", "packages", "core"),
            projectID: Project.ID.make("git-project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const sources = [
            embedded("alpha", "project", "alpha"),
            embedded("beta", "project", "beta"),
            embedded("global", "global", "global"),
          ]
          const initial = yield* runSkill(input, sources)
          const ids = initial.management.map((item) => item.id)
          yield* runSkill(input, sources, { id: ids[1], enabled: false })
          yield* runSkill(input, sources, { id: ids[0], enabled: false })
          yield* runSkill(input, sources, { id: ids[2], enabled: false })

          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(input, "project"), "utf8")))).toEqual({
            version: 1,
            disabled: [ids[0], ids[1]].toSorted(),
          })
          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(input, "global"), "utf8")))).toEqual({
            version: 1,
            disabled: [ids[2]],
          })
          expect((yield* runSkill(input, sources)).management.map((item) => item.status)).toEqual([
            "disabled",
            "disabled",
            "disabled",
          ])
        }),
      ),
    ),
  )

  it.live("shares global disable state across locations", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "first"),
            projectID: Project.ID.make("first"),
            projectRoot: path.join(tmp.path, "first"),
          }
          const second = {
            ...first,
            directory: path.join(tmp.path, "second"),
            projectID: Project.ID.make("second"),
            projectRoot: path.join(tmp.path, "second"),
          }
          const sources = [embedded("shared", "global", "shared")]
          const id = (yield* runSkill(first, sources)).management[0].id
          yield* runSkill(first, sources, { id, enabled: false })
          expect((yield* runSkill(second, sources)).management[0].status).toBe("disabled")
        }),
      ),
    ),
  )

  it.live("isolates project state across distinct Git projects", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "first"),
            projectID: Project.ID.make("first"),
            projectRoot: path.join(tmp.path, "first"),
          }
          const second = {
            ...first,
            directory: path.join(tmp.path, "second"),
            projectID: Project.ID.make("second"),
            projectRoot: path.join(tmp.path, "second"),
          }
          const sources = [embedded("local", "project", "shared-installation")]
          const id = (yield* runSkill(first, sources)).management[0].id
          yield* runSkill(first, sources, { id, enabled: false })
          expect((yield* runSkill(second, sources)).management[0].status).toBe("active")
        }),
      ),
    ),
  )

  it.live("shares project state across opened directories in one Git project", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo", "packages", "first"),
            projectID: Project.ID.make("shared-git-project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const second = { ...first, directory: path.join(tmp.path, "repo", "packages", "second") }
          const sources = [embedded("local", "project", "shared-installation")]
          const id = (yield* runSkill(first, sources)).management[0].id
          yield* runSkill(first, sources, { id, enabled: false })
          expect((yield* runSkill(second, sources)).management[0].status).toBe("disabled")
          expect(stateFile(first, "project")).toBe(stateFile(second, "project"))
        }),
      ),
    ),
  )

  it.live("isolates non-Git global projects by opened directory", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "first"),
            projectID: Project.ID.global,
            projectRoot: path.parse(tmp.path).root,
          }
          const second = { ...first, directory: path.join(tmp.path, "second") }
          const sources = [embedded("local", "project", "shared-installation")]
          const id = (yield* runSkill(first, sources)).management[0].id
          yield* runSkill(first, sources, { id, enabled: false })
          expect((yield* runSkill(second, sources)).management[0].status).toBe("active")
          expect(stateFile(first, "project")).not.toBe(stateFile(second, "project"))
        }),
      ),
    ),
  )

  it.live("keeps source scope authoritative over stale IDs in the other state file", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const sources = [embedded("moved", "global", "moved")]
          const id = (yield* runSkill(input, sources)).management[0].id
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(stateFile(input, "project")), { recursive: true })
            await fs.writeFile(stateFile(input, "project"), JSON.stringify({ version: 1, disabled: [id] }))
          })
          expect((yield* runSkill(input, sources)).management[0].status).toBe("active")
        }),
      ),
    ),
  )

  it.live("warns for malformed state and treats malformed or missing state as enabled", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(stateFile(input, "global")), { recursive: true })
            await fs.writeFile(stateFile(input, "global"), "{private malformed content")
          })
          const logs: unknown[] = []
          const logger = Logger.make((options) => logs.push(options.message))
          const result = yield* runSkill(input, [
            embedded("global", "global", "global"),
            embedded("project", "project", "project"),
          ]).pipe(Effect.provide(Logger.layer([logger])))

          expect(result.management.map((item) => item.status)).toEqual(["active", "active"])
          expect(JSON.stringify(logs)).toContain(stateFile(input, "global"))
          expect(JSON.stringify(logs)).not.toContain("private malformed content")
        }),
      ),
    ),
  )

  it.live("fails missing installation mutations without writing state", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const input: SkillLayerInput = {
          state: path.join(tmp.path, "state"),
          directory: path.join(tmp.path, "repo"),
          projectID: Project.ID.make("project"),
          projectRoot: path.join(tmp.path, "repo"),
        }
        return Effect.gen(function* () {
          const error = yield* Effect.flip(
            runSkill(input, [embedded("known", "project", "known")], {
              id: SkillV2.ManagementID.make("missing"),
              enabled: false,
            }),
          )
          expect(error).toBeInstanceOf(SkillV2.NotFoundError)
          if (!(error instanceof SkillV2.NotFoundError)) return
          expect(error.id).toBe(SkillV2.ManagementID.make("missing"))
          expect(yield* Effect.promise(() => fs.stat(path.join(input.state, "skills")).then(() => true, () => false))).toBe(
            false,
          )
        })
      }),
    ),
  )

  it.live("classifies origin-free directories as nondeletable project plugin sources", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "local"), { recursive: true })
            await write(tmp.path, "local", "Local plugin skill")
          })

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(tmp.path) }))

          expect(yield* skill.management.list()).toEqual([
            expect.objectContaining({
              name: "local",
              source: { type: "plugin", scope: "project", value: AbsolutePath.make(tmp.path) },
              deletable: false,
              deleteBlocked: "plugin",
            }),
          ])
        }),
      ),
    ),
  )

  it.live("loads URL sources and filters skills for agents", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Deploy production")
          })
          pulls = 0
          urls.set("https://example.test/skills/", [AbsolutePath.make(tmp.path)])

          const agents = yield* AgentV2.Service
          yield* agents.transform((editor) =>
            editor.update(AgentV2.ID.make("reviewer"), (agent) => {
              agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
            }),
          )

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => editor.source({ type: "url", url: "https://example.test/skills/" }))

          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect(pulls).toBe(1)
          expect(SkillV2.available(yield* skill.list(), (yield* agents.get(AgentV2.ID.make("reviewer")))!)).toEqual([])
        }),
      ),
    ),
  )
})

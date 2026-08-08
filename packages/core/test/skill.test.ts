import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Function, Layer, Logger, PlatformError } from "effect"
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
import {
  deleteTarget,
  id,
  management,
  project,
  remove,
  updateState,
  type Installed,
} from "@opencode-ai/core/skill/management"
import { SkillSafeMove } from "@opencode-ai/core/skill/safe-move"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
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

const portableSafeMove = SkillSafeMove.Service.of({
  available: () => Effect.succeed(true),
  prepare: (input) => {
    const source = path.resolve(input.sourceRoot, input.source)
    const staging = path.resolve(input.trashRoot, input.staging)
    const final = path.resolve(input.trashRoot, input.final)
    const record = { current: staging }
    const move = (from: string, to: string) =>
      Effect.tryPromise({
        try: async () => {
          const occupied = await fs.lstat(to).then(
            () => true,
            () => false,
          )
          if (occupied) throw new SkillSafeMove.SafeMoveError({ reason: "conflict", detail: "destination exists" })
          await fs.rename(from, to)
        },
        catch: (cause) =>
          cause instanceof SkillSafeMove.SafeMoveError
            ? cause
            : new SkillSafeMove.SafeMoveError({ reason: "io", detail: String(cause) }),
      })
    const exists = (target: string) =>
      Effect.promise(() =>
        fs.lstat(target).then(
          () => true,
          () => false,
        ),
      )
    const rollback = Effect.gen(function* () {
      const payload = path.join(record.current, "payload")
      if (yield* exists(payload)) yield* move(payload, source)
      if (yield* exists(record.current)) yield* Effect.promise(() => fs.rm(record.current, { recursive: true }))
    })
    return Effect.succeed({
      target: source,
      stage: (metadata) =>
        Effect.tryPromise({
          try: async () => {
            await fs.mkdir(staging)
            await fs.writeFile(path.join(staging, "metadata.json"), metadata, { flag: "wx" })
          },
          catch: (cause) => new SkillSafeMove.SafeMoveError({ reason: "io", detail: String(cause) }),
        }),
      move: move(source, path.join(staging, "payload")),
      finalize: move(staging, final).pipe(Effect.tap(() => Effect.sync(() => (record.current = final)))),
      rollback,
    })
  },
})

type SkillLayerInput = {
  state: string
  directory: string
  projectID: Project.ID
  projectRoot: string
  filesystem?: FSUtil.Interface
  safeMove?: SkillSafeMove.Interface
  flock?: EffectFlock.Interface
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
      ...(input.filesystem ? ([[FSUtil.node, Layer.succeed(FSUtil.Service, input.filesystem)]] as const) : []),
      ...(input.flock ? ([[EffectFlock.node, Layer.succeed(EffectFlock.Service, input.flock)]] as const) : []),
      [SkillSafeMove.node, Layer.succeed(SkillSafeMove.Service, input.safeMove ?? portableSafeMove)],
    ]),
  )
}

function stateDependencies(state: string) {
  return Layer.fresh(
    AppNodeBuilder.build(LayerNode.group([FSUtil.node, EffectFlock.node, SkillSafeMove.node]), [
      [Global.node, Global.layerWith({ state })],
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

function buildSkill(input: SkillLayerInput) {
  return Layer.build(skillLayer(input)).pipe(Effect.map((context) => Context.get(context, SkillV2.Service)))
}

function register(skill: SkillV2.Interface, sources: readonly SkillV2.Source[]) {
  return skill.transform((editor) => sources.forEach((source) => editor.source(source)))
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
  it.live("resolves deletion targets only for safely owned local skills", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const context = yield* Layer.build(stateDependencies(path.join(tmp.path, "state")))
          const fsService = Context.get(context, FSUtil.Service)
          const safeMove = Context.get(context, SkillSafeMove.Service)
          const available = yield* safeMove.available()
          const sourceRoot = path.join(tmp.path, "skills")
          const outside = path.join(tmp.path, "outside")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(sourceRoot, "normal"), { recursive: true })
            await fs.mkdir(outside, { recursive: true })
            await write(sourceRoot, "normal", "Normal")
            await fs.writeFile(path.join(sourceRoot, "root.md"), "---\nname: root\n---\n# root")
            await fs.writeFile(path.join(outside, "SKILL.md"), "---\nname: linked\n---\n# linked")
            await fs.symlink(outside, path.join(sourceRoot, "linked"))
          })

          const directory = (
            location: string,
            origin: "config-directory" | "config-file" | false = "config-directory",
          ): Installed => ({
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              ...(origin ? { origin: { type: origin, scope: "project" as const, value: sourceRoot } } : {}),
            }),
            info: SkillV2.Info.make({
              name: path.basename(path.dirname(location)),
              location: AbsolutePath.make(location),
              content: "test",
            }),
          })
          const embeddedEntry: Installed = {
            source: embedded("builtin", "global", "builtin"),
            info: embedded("builtin", "global", "builtin").skill,
          }
          const urlEntry: Installed = {
            source: SkillV2.UrlSource.make({
              type: "url",
              url: "https://example.test/skills/",
              origin: { type: "config-file", scope: "project", value: "/repo/opencode.json" },
            }),
            info: SkillV2.Info.make({
              name: "remote",
              location: AbsolutePath.make(path.join(outside, "remote", "SKILL.md")),
              content: "remote",
            }),
          }
          const cases = [
            {
              name: "conventional directory",
              entry: directory(path.join(sourceRoot, "normal", "SKILL.md")),
              expected: available
                ? { target: AbsolutePath.make(path.join(sourceRoot, "normal")) }
                : { blocked: "unsafe" as const },
            },
            {
              name: "root markdown file",
              entry: directory(path.join(sourceRoot, "root.md"), "config-file"),
              expected: available
                ? { target: AbsolutePath.make(path.join(sourceRoot, "root.md")) }
                : { blocked: "unsafe" as const },
            },
            {
              name: "source root",
              entry: directory(sourceRoot),
              expected: { blocked: "unsafe" },
            },
            {
              name: "symlinked skill",
              entry: directory(path.join(sourceRoot, "linked", "SKILL.md")),
              expected: { blocked: "unsafe" },
            },
            { name: "embedded", entry: embeddedEntry, expected: { blocked: "builtin" } },
            { name: "url", entry: urlEntry, expected: { blocked: "remote" } },
            {
              name: "origin-free plugin",
              entry: directory(path.join(sourceRoot, "normal", "SKILL.md"), false),
              expected: { blocked: "plugin" },
            },
          ] as const

          for (const item of cases) {
            expect(yield* deleteTarget(item.entry, fsService, safeMove), item.name).toEqual(item.expected)
          }
          const managed = project(
            cases.map((item) => item.entry),
            { global: new Set(), project: new Set() },
            yield* Effect.all(cases.map((item) => deleteTarget(item.entry, fsService, safeMove))),
          )
          expect(
            managed.map((item) =>
              item.deletable
                ? { deletable: item.deletable, deleteTarget: item.deleteTarget }
                : { deletable: item.deletable, deleteBlocked: item.deleteBlocked },
            ),
          ).toEqual([
            available
              ? { deletable: true, deleteTarget: AbsolutePath.make(path.join(sourceRoot, "normal")) }
              : { deletable: false, deleteBlocked: "unsafe" },
            available
              ? { deletable: true, deleteTarget: AbsolutePath.make(path.join(sourceRoot, "root.md")) }
              : { deletable: false, deleteBlocked: "unsafe" },
            { deletable: false, deleteBlocked: "unsafe" },
            { deletable: false, deleteBlocked: "unsafe" },
            { deletable: false, deleteBlocked: "builtin" },
            { deletable: false, deleteBlocked: "remote" },
            { deletable: false, deleteBlocked: "plugin" },
          ])
        }),
      ),
    ),
  )

  it.live("caches source root canonicalization only within one management projection", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const context = yield* Layer.build(stateDependencies(path.join(tmp.path, "state")))
          const fsService = Context.get(context, FSUtil.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          const outside = path.join(tmp.path, "outside")
          yield* Effect.promise(async () => {
            await Promise.all(
              ["one", "two", "three"].map((name) => fs.mkdir(path.join(sourceRoot, name), { recursive: true })),
            )
            await Promise.all(["one", "two", "three"].map((name) => write(sourceRoot, name, name)))
            await fs.mkdir(outside)
          })
          const source = SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(sourceRoot),
            origin: { type: "config-directory", scope: "global", value: sourceRoot },
          })
          const entries = ["one", "two", "three"].map(
            (name): Installed => ({
              source,
              info: SkillV2.Info.make({
                name,
                location: AbsolutePath.make(path.join(sourceRoot, name, "SKILL.md")),
                content: name,
              }),
            }),
          )
          const calls = { root: 0, candidates: 0 }
          const filesystem = FSUtil.Service.of({
            ...fsService,
            realPath: (target) =>
              fsService.realPath(target).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    if (target === sourceRoot) calls.root++
                    if (target !== sourceRoot) calls.candidates++
                  }),
                ),
              ),
          })
          const disabled = { global: new Set<SkillV2.ManagementID>(), project: new Set<SkillV2.ManagementID>() }

          expect(
            (yield* management(entries, disabled, filesystem, portableSafeMove)).every((item) => item.deletable),
          ).toBe(true)
          expect(calls).toEqual({ root: 1, candidates: 3 })

          yield* Effect.promise(async () => {
            await fs.rename(sourceRoot, path.join(tmp.path, "original-skills"))
            await fs.symlink(outside, sourceRoot)
          })
          expect(
            (yield* management(entries, disabled, filesystem, portableSafeMove)).map((item) => item.deleteBlocked),
          ).toEqual(["unsafe", "unsafe", "unsafe"])
          expect(calls.root).toBe(2)
        }),
      ),
    ),
  )

  it.live("marks configured local skills unsafe when atomic no-replace move is unsupported", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const context = yield* Layer.build(stateDependencies(path.join(tmp.path, "state")))
          const fsService = Context.get(context, FSUtil.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "local"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "local", "Local"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "local",
              location: AbsolutePath.make(path.join(sourceRoot, "local", "SKILL.md")),
              content: "local",
            }),
          }
          const unsupported = SkillSafeMove.Service.of({
            available: () => Effect.succeed(false),
            prepare: () =>
              Effect.fail(
                new SkillSafeMove.SafeMoveError({ reason: "unsupported", detail: "unsupported test platform" }),
              ),
          })

          expect(yield* deleteTarget(entry, fsService, unsupported)).toEqual({ blocked: "unsafe" })
          expect(
            yield* management([entry], { global: new Set(), project: new Set() }, fsService, unsupported),
          ).toMatchObject([{ deletable: false, deleteBlocked: "unsafe" }])
        }),
      ),
    ),
  )

  it.live("treats a throwing capability probe as stable unsupported", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const context = yield* Layer.build(stateDependencies(path.join(tmp.path, "state")))
          const fsService = Context.get(context, FSUtil.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "local"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "local", "Local"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "local",
              location: AbsolutePath.make(path.join(sourceRoot, "local", "SKILL.md")),
              content: "local",
            }),
          }
          const probes = { value: 0 }
          const throwing = SkillSafeMove.make({
            probeLibrary: async () => {
              probes.value++
              throw new Error("probe failed")
            },
          })

          for (const _ of [0, 1]) {
            expect(yield* throwing.available()).toBe(false)
            expect(
              yield* management([entry], { global: new Set(), project: new Set() }, fsService, throwing),
            ).toMatchObject([{ deletable: false, deleteBlocked: "unsafe" }])
          }
          expect(probes.value).toBe(1)
        }),
      ),
    ),
  )

  it.live("maps safe move errno categories to stable management errors", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const cases = [
            { name: "missing", reason: "not-found", errno: os.constants.errno.ENOENT, error: SkillV2.NotFoundError },
            { name: "loop", reason: "unsafe", errno: os.constants.errno.ELOOP, error: SkillV2.UnsafePathError },
            { name: "cross-device", reason: "io", errno: os.constants.errno.EXDEV, error: SkillV2.OperationError },
            { name: "denied", reason: "io", errno: os.constants.errno.EACCES, error: SkillV2.OperationError },
          ] as const

          for (const item of cases) {
            const sourceRoot = path.join(tmp.path, item.name, "skills")
            yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, item.name), { recursive: true }))
            yield* Effect.promise(() => write(sourceRoot, item.name, item.name))
            const entry: Installed = {
              source: SkillV2.DirectorySource.make({
                type: "directory",
                path: AbsolutePath.make(sourceRoot),
                origin: { type: "config-directory", scope: "global", value: sourceRoot },
              }),
              info: SkillV2.Info.make({
                name: item.name,
                location: AbsolutePath.make(path.join(sourceRoot, item.name, "SKILL.md")),
                content: item.name,
              }),
            }
            const safeMove = SkillSafeMove.Service.of({
              ...portableSafeMove,
              prepare: (input) =>
                portableSafeMove.prepare(input).pipe(
                  Effect.map((handle) => ({
                    ...handle,
                    move: Effect.fail(
                      new SkillSafeMove.SafeMoveError({
                        reason: item.reason,
                        detail: item.name,
                        errno: item.errno,
                      }),
                    ),
                  })),
                ),
            })

            const error = yield* remove(
              fsService,
              safeMove,
              flock,
              Global.make({ state }),
              path.join(state, "skills", `${item.name}.json`),
              entry,
            ).pipe(Effect.flip)
            expect(error, item.name).toBeInstanceOf(item.error)
            expect(yield* Effect.promise(() => fs.stat(path.dirname(entry.info.location)).then(() => true))).toBe(true)
          }
        }),
      ),
    ),
  )

  it.live("moves directory and root markdown skills into recovery and refreshes their source", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("delete-project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(sourceRoot, "review"), { recursive: true })
            await write(sourceRoot, "review", "Review changes")
            await fs.writeFile(
              path.join(sourceRoot, "release.md"),
              "---\nname: release\ndescription: Prepare release\n---\n# release",
            )
          })
          const source = SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(sourceRoot),
            origin: { type: "config-directory", scope: "project", value: sourceRoot },
          })
          const skill = yield* buildSkill(input)
          yield* register(skill, [source])
          const initial = yield* skill.management.list()
          expect(
            initial.map((item) => ({ name: item.name, deletable: item.deletable, target: item.deleteTarget })),
          ).toEqual([
            {
              name: "release",
              deletable: true,
              target: AbsolutePath.make(path.join(sourceRoot, "release.md")),
            },
            {
              name: "review",
              deletable: true,
              target: AbsolutePath.make(path.join(sourceRoot, "review")),
            },
          ])
          const review = initial.find((item) => item.name === "review")!
          yield* skill.management.setEnabled(review.id, false)
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "late"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "late", "Loaded after cache invalidation"))

          const afterReview = yield* skill.management.remove(review.id)
          expect(afterReview.map((item) => item.name)).toEqual(["late", "release"])
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.join(sourceRoot, "review")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(input, "project"), "utf8")))).toEqual({
            version: 1,
            disabled: [],
          })

          const release = afterReview.find((item) => item.name === "release")!
          const afterRelease = yield* skill.management.remove(release.id)
          expect(afterRelease.map((item) => item.name)).toEqual(["late"])
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.join(sourceRoot, "release.md")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)

          const trashRoot = path.join(input.state, "skills", "trash")
          const records = (yield* Effect.promise(() => fs.readdir(trashRoot))).toSorted()
          expect(records).toHaveLength(2)
          expect(records.every((record) => /^\d+-[a-f0-9]{12}-[a-f0-9-]{36}$/.test(record))).toBe(true)
          const recovered = yield* Effect.promise(() =>
            Promise.all(
              records.map(async (record) => ({
                metadata: JSON.parse(await fs.readFile(path.join(trashRoot, record, "metadata.json"), "utf8")),
                payload: await fs.stat(path.join(trashRoot, record, "payload")),
              })),
            ),
          )
          expect(recovered.map((item) => item.metadata.originalPath).toSorted()).toEqual(
            [path.join(sourceRoot, "release.md"), path.join(sourceRoot, "review")].toSorted(),
          )
          expect(recovered.map((item) => item.metadata.id).toSorted()).toEqual([release.id, review.id].toSorted())
          expect(recovered.every((item) => typeof item.metadata.deletedAt === "string")).toBe(true)
          expect(recovered.some((item) => item.payload.isDirectory())).toBe(true)
          expect(recovered.some((item) => item.payload.isFile())).toBe(true)
        }),
      ),
    ),
  )

  it.live("writes native recovery metadata with owner-only read and write permissions", () => {
    if (process.platform === "win32") return Effect.void
    return Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const safeMove = SkillSafeMove.make()
          if (!(yield* safeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "review")
          const trashRoot = path.join(tmp.path, "trash")
          yield* Effect.promise(() => Promise.all([fs.mkdir(target, { recursive: true }), fs.mkdir(trashRoot)]))
          yield* Effect.promise(() => write(sourceRoot, "review", "Native recovery permissions"))
          const metadata = JSON.stringify({ name: "review" })

          yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* safeMove.prepare({
                sourceRoot,
                source: "review",
                trashRoot,
                staging: "review.staging",
                final: "review",
              })
              yield* handle.stage(metadata)
              yield* handle.move
              yield* handle.finalize
            }),
          )

          const file = path.join(trashRoot, "review", "metadata.json")
          expect((yield* Effect.promise(() => fs.stat(file))).mode & 0o777).toBe(0o600)
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(metadata)
        }),
      ),
    )
  })

  it.live("rolls back native deletion when securing recovery metadata fails", () => {
    if (process.platform === "win32") return Effect.void
    return Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "review")
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "review", "Failed metadata permissions"))
          const descriptor = { value: undefined as number | undefined }
          const safeMove = SkillSafeMove.make({
            fchmod: (value) => {
              descriptor.value = value
              return os.constants.errno.EIO
            },
          })
          if (!(yield* safeMove.available())) return
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "review",
              location: AbsolutePath.make(path.join(target, "SKILL.md")),
              content: "Failed metadata permissions",
            }),
          }

          const error = yield* remove(
            fsService,
            safeMove,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.flip)

          expect(error).toBeInstanceOf(SkillV2.OperationError)
          expect(error).toMatchObject({ operation: "delete" })
          expect(descriptor.value).toBeNumber()
          const metadataDescriptor = descriptor.value
          if (metadataDescriptor === undefined) throw new Error("Expected metadata descriptor")
          expect(
            yield* Effect.promise(() =>
              fs.stat(`/dev/fd/${metadataDescriptor}`).then(
                () => false,
                () => true,
              ),
            ),
          ).toBe(true)
          expect(yield* Effect.promise(() => fs.readFile(path.join(target, "SKILL.md"), "utf8"))).toContain(
            "Failed metadata permissions",
          )
          expect(yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")))).toEqual([])
        }),
      ),
    )
  })

  it.live("treats lock release failure after commit as successful deletion and clears the source cache", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const base: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("release-failure-delete"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const context = yield* Layer.build(stateDependencies(base.state))
          const fsService = Context.get(context, FSUtil.Service)
          const lockMetadata = path.join(
            base.state,
            "locks",
            `${Hash.fast(stateFile(base, "project"))}.lock`,
            "meta.json",
          )
          const release = { broken: false }
          const safeMove = SkillSafeMove.Service.of({
            ...portableSafeMove,
            prepare: (input) =>
              portableSafeMove.prepare(input).pipe(
                Effect.map((handle) => ({
                  ...handle,
                  finalize: handle.finalize.pipe(
                    Effect.andThen(
                      fsService
                        .remove(lockMetadata, { force: true })
                        .pipe(
                          Effect.mapError(
                            (cause) => new SkillSafeMove.SafeMoveError({ reason: "io", detail: String(cause) }),
                          ),
                        ),
                    ),
                    Effect.tap(() => Effect.sync(() => (release.broken = true))),
                  ),
                })),
              ),
          })
          const input = { ...base, safeMove }
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "remove"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "remove", "Release failure"))
          const source = SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(sourceRoot),
            origin: { type: "config-directory", scope: "project", value: sourceRoot },
          })
          const skill = yield* buildSkill(input)
          yield* register(skill, [source])
          const removed = (yield* skill.management.list())[0]
          yield* skill.management.setEnabled(removed.id, false)
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "late"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "late", "Cache refresh"))

          const next = yield* skill.management.remove(removed.id)
          expect(release.broken).toBe(true)
          expect(next.map((item) => item.name)).toEqual(["late"])
          expect((yield* skill.management.list()).map((item) => item.name)).toEqual(["late"])
          expect((yield* skill.list()).map((item) => item.name)).toEqual(["late"])
          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(base, "project"), "utf8")))).toEqual({
            version: 1,
            disabled: [],
          })
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.join(sourceRoot, "remove")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(yield* Effect.promise(() => fs.readdir(path.join(base.state, "skills", "trash")))).toHaveLength(1)
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.dirname(lockMetadata)).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)

          const updated = yield* skill.management.setEnabled(next[0].id, false).pipe(Effect.timeout("1 second"))
          expect(updated.map((item) => ({ name: item.name, status: item.status }))).toEqual([
            { name: "late", status: "disabled" },
          ])
          expect(yield* skill.list()).toEqual([])
        }),
      ),
    ),
  )

  it.live("protects non-owned and unsafe deletion targets without touching their files", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const global = Global.make({ state })
          const file = path.join(state, "skills", "global.json")
          const sourceRoot = path.join(tmp.path, "skills")
          const outside = path.join(tmp.path, "outside")
          const realSource = path.join(tmp.path, "real-source")
          const linkedSource = path.join(tmp.path, "linked-source")
          yield* Effect.promise(async () => {
            await fs.mkdir(sourceRoot, { recursive: true })
            await fs.mkdir(path.join(outside, "linked"), { recursive: true })
            await fs.mkdir(path.join(outside, "escape"), { recursive: true })
            await fs.mkdir(path.join(realSource, "safe"), { recursive: true })
            await fs.writeFile(path.join(outside, "linked", "SKILL.md"), "---\nname: linked\n---\n# linked")
            await fs.writeFile(path.join(outside, "escape", "SKILL.md"), "---\nname: escape\n---\n# escape")
            await fs.writeFile(path.join(realSource, "safe", "SKILL.md"), "---\nname: safe\n---\n# safe")
            await fs.symlink(path.join(outside, "linked"), path.join(sourceRoot, "linked"))
            await fs.symlink(realSource, linkedSource)
          })
          const local = (location: string, origin?: SkillV2.DirectorySource["origin"]): Installed => ({
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              ...(origin ? { origin } : {}),
            }),
            info: SkillV2.Info.make({
              name: "local",
              location: AbsolutePath.make(location),
              content: "local",
            }),
          })
          const protectedEntries: Installed[] = [
            {
              source: embedded("builtin", "global", "builtin"),
              info: embedded("builtin", "global", "builtin").skill,
            },
            {
              source: SkillV2.UrlSource.make({
                type: "url",
                url: "https://example.test/skills/",
                origin: { type: "config-file", scope: "global", value: "/config/opencode.json" },
              }),
              info: SkillV2.Info.make({
                name: "remote",
                location: AbsolutePath.make(path.join(outside, "remote", "SKILL.md")),
                content: "remote",
              }),
            },
            local(path.join(sourceRoot, "plugin", "SKILL.md")),
          ]
          let realPathCalls = 0
          const inaccessible = FSUtil.Service.of({
            ...fsService,
            realPath: () => {
              realPathCalls++
              return Effect.die("protected sources must not resolve paths")
            },
          })
          for (const entry of protectedEntries) {
            const reason =
              entry.source.type === "embedded" ? "builtin" : entry.source.type === "url" ? "remote" : "plugin"
            const target = yield* deleteTarget(entry, inaccessible, portableSafeMove)
            expect(target).toEqual({ blocked: reason })
            const error = yield* remove(inaccessible, portableSafeMove, flock, global, file, entry).pipe(Effect.flip)
            expect(error).toBeInstanceOf(SkillV2.ProtectedError)
            expect(error).toMatchObject({ id: id(entry), reason })
          }
          expect(realPathCalls).toBe(0)

          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const unsafeEntries = [
            local(sourceRoot, {
              type: "config-directory",
              scope: "global",
              value: sourceRoot,
            }),
            local(path.join(sourceRoot, "linked", "SKILL.md"), {
              type: "config-directory",
              scope: "global",
              value: sourceRoot,
            }),
            local(path.join(sourceRoot, "..", "outside", "escape", "SKILL.md"), {
              type: "config-directory",
              scope: "global",
              value: sourceRoot,
            }),
            {
              source: SkillV2.DirectorySource.make({
                type: "directory",
                path: AbsolutePath.make(linkedSource),
                origin: { type: "config-directory", scope: "global", value: linkedSource },
              }),
              info: SkillV2.Info.make({
                name: "safe",
                location: AbsolutePath.make(path.join(linkedSource, "safe", "SKILL.md")),
                content: "safe",
              }),
            },
          ]
          for (const entry of unsafeEntries) {
            const error = yield* remove(fsService, liveSafeMove, flock, global, file, entry).pipe(Effect.flip)
            expect(error).toBeInstanceOf(SkillV2.UnsafePathError)
            expect(error).toMatchObject({ id: id(entry), reason: "unsafe" })
          }
          expect(
            yield* Effect.promise(() =>
              fs.stat(sourceRoot).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(true)
          expect(
            yield* Effect.promise(() =>
              fs.lstat(path.join(sourceRoot, "linked")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(true)
          expect(yield* Effect.promise(() => fs.stat(path.join(outside, "linked", "SKILL.md")).then(() => true))).toBe(
            true,
          )
          expect(yield* Effect.promise(() => fs.stat(path.join(outside, "escape", "SKILL.md")).then(() => true))).toBe(
            true,
          )
          expect(yield* Effect.promise(() => fs.stat(path.join(realSource, "safe", "SKILL.md")).then(() => true))).toBe(
            true,
          )
          expect(yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")).catch(() => []))).toEqual(
            [],
          )
        }),
      ),
    ),
  )

  it.live("distinguishes conservative projection from scoped mutation preparation failures", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          const outside = path.join(tmp.path, "outside")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "strict"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "strict", "Strict mutation"))
          yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "strict",
              location: AbsolutePath.make(path.join(sourceRoot, "strict", "SKILL.md")),
              content: "strict",
            }),
          }
          const failure = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "realPath",
            pathOrDescriptor: sourceRoot,
          })
          const inaccessible = FSUtil.Service.of({ ...fsService, realPath: () => Effect.fail(failure) })
          expect(yield* deleteTarget(entry, inaccessible, portableSafeMove)).toEqual({ blocked: "unsafe" })
          const io = SkillSafeMove.Service.of({
            ...portableSafeMove,
            prepare: () => Effect.fail(new SkillSafeMove.SafeMoveError({ reason: "io", detail: "prepare failed" })),
          })
          expect(
            yield* remove(
              inaccessible,
              io,
              flock,
              Global.make({ state }),
              path.join(state, "skills", "io.json"),
              entry,
            ).pipe(Effect.flip),
          ).toMatchObject({ operation: "delete" })

          const unsafe = SkillSafeMove.Service.of({
            ...portableSafeMove,
            prepare: () =>
              Effect.fail(new SkillSafeMove.SafeMoveError({ reason: "unsafe", detail: "identity changed" })),
          })
          const error = yield* remove(
            fsService,
            unsafe,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "recheck.json"),
            entry,
          ).pipe(Effect.flip)
          expect(error).toBeInstanceOf(SkillV2.UnsafePathError)
          expect(error).toMatchObject({ id: id(entry), reason: "unsafe" })
          expect(yield* Effect.promise(() => fs.stat(path.dirname(entry.info.location)).then(() => true))).toBe(true)
          expect(yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")).catch(() => []))).toEqual(
            [],
          )
        }),
      ),
    ),
  )

  it.live("revalidates the discovered installation when its source root is replaced before prepare", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const originalRoot = path.join(tmp.path, "original-skills")
          const outside = path.join(tmp.path, "outside")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(sourceRoot, "victim"), { recursive: true })
            await write(sourceRoot, "victim", "Original skill")
            await fs.mkdir(path.join(outside, "victim"), { recursive: true })
            await write(outside, "victim", "Outside skill")
          })
          const source = SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(sourceRoot),
            origin: { type: "config-directory", scope: "global", value: sourceRoot },
          })
          const replaced = { value: false }
          const replacedSafeMove = SkillSafeMove.Service.of({
            ...liveSafeMove,
            prepare: (input) =>
              Effect.promise(async () => {
                if (replaced.value || input.sourceRoot !== sourceRoot) return
                replaced.value = true
                await fs.rename(sourceRoot, originalRoot)
                await fs.rename(outside, sourceRoot)
              }).pipe(Effect.andThen(liveSafeMove.prepare(input))),
          })
          const skill = yield* buildSkill({
            state,
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("prepare-root-replacement"),
            projectRoot: path.join(tmp.path, "repo"),
            safeMove: replacedSafeMove,
          })
          yield* register(skill, [source])
          const entry = (yield* skill.management.list())[0]

          const error = yield* skill.management.remove(entry.id).pipe(Effect.flip)
          expect(replaced.value).toBe(true)
          expect(error instanceof SkillV2.NotFoundError || error instanceof SkillV2.UnsafePathError).toBe(true)
          expect(
            yield* Effect.promise(() => fs.readFile(path.join(sourceRoot, "victim", "SKILL.md"), "utf8")),
          ).toContain("Outside skill")
          expect(
            yield* Effect.promise(() => fs.readFile(path.join(originalRoot, "victim", "SKILL.md"), "utf8")),
          ).toContain("Original skill")
          expect(yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")).catch(() => []))).toEqual(
            [],
          )
        }),
      ),
    ),
  )

  it.live("rejects a final skill entry replaced after its identity is captured", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const original = path.join(sourceRoot, "captured")
          const displaced = path.join(sourceRoot, "captured-original")
          yield* Effect.promise(() => fs.mkdir(original, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "captured", "Captured original"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "captured",
              location: AbsolutePath.make(path.join(original, "SKILL.md")),
              content: "Captured original",
            }),
          }
          const checked = yield* Deferred.make<void>()
          const replaced = yield* Deferred.make<void>()
          yield* Deferred.await(checked).pipe(
            Effect.andThen(
              Effect.promise(async () => {
                await fs.rename(original, displaced)
                await fs.mkdir(original)
                await fs.writeFile(path.join(original, "SKILL.md"), "replacement")
              }),
            ),
            Effect.andThen(Deferred.succeed(replaced, undefined)),
            Effect.forkScoped,
          )
          const safeMove = SkillSafeMove.make({
            beforeSourceRename: Deferred.succeed(checked, undefined).pipe(Effect.andThen(Deferred.await(replaced))),
          })

          const error = yield* remove(
            fsService,
            safeMove,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.flip)
          expect(error).toMatchObject({ operation: "delete" })
          expect(
            yield* Effect.promise(() =>
              fs.stat(original).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(yield* Effect.promise(() => fs.readFile(path.join(displaced, "SKILL.md"), "utf8"))).toContain(
            "Captured original",
          )
          const records = yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")))
          expect(records).toHaveLength(1)
          expect(
            yield* Effect.promise(() =>
              fs.readFile(path.join(state, "skills", "trash", records[0], "payload", "SKILL.md"), "utf8"),
            ),
          ).toBe("replacement")
        }),
      ),
    ),
  )

  it.live("keeps the raced payload when post-move identity rollback conflicts", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "rollback")
          const displaced = path.join(sourceRoot, "rollback-original")
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "rollback", "Original payload"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "rollback",
              location: AbsolutePath.make(path.join(target, "SKILL.md")),
              content: "Original payload",
            }),
          }
          const checked = yield* Deferred.make<void>()
          const replaced = yield* Deferred.make<void>()
          yield* Deferred.await(checked).pipe(
            Effect.andThen(
              Effect.promise(async () => {
                await fs.rename(target, displaced)
                await fs.mkdir(target)
                await fs.writeFile(path.join(target, "SKILL.md"), "raced payload")
              }),
            ),
            Effect.andThen(Deferred.succeed(replaced, undefined)),
            Effect.forkScoped,
          )
          const safeMove = SkillSafeMove.make({
            beforeSourceRename: Deferred.succeed(checked, undefined).pipe(Effect.andThen(Deferred.await(replaced))),
            afterSourceRename: Effect.promise(async () => {
              await fs.mkdir(target)
              await fs.writeFile(path.join(target, "SKILL.md"), "new skill")
            }),
          })

          const error = yield* remove(
            fsService,
            safeMove,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.flip)
          expect(error).toMatchObject({ operation: "delete" })
          expect(yield* Effect.promise(() => fs.readFile(path.join(target, "SKILL.md"), "utf8"))).toBe("new skill")
          expect(yield* Effect.promise(() => fs.readFile(path.join(displaced, "SKILL.md"), "utf8"))).toContain(
            "Original payload",
          )
          const records = yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")))
          expect(records).toHaveLength(1)
          expect(records[0].endsWith(".staging")).toBe(true)
          expect(
            yield* Effect.promise(() =>
              fs.readFile(path.join(state, "skills", "trash", records[0], "payload", "SKILL.md"), "utf8"),
            ),
          ).toBe("raced payload")
        }),
      ),
    ),
  )

  it.live("does not move a replacement final record during identity compensation", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "final-race")
          const trash = path.join(state, "skills", "trash")
          const displaced = path.join(trash, "displaced-final")
          const replacement = { path: "" }
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "final-race", "Original final payload"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "final-race",
              location: AbsolutePath.make(path.join(target, "SKILL.md")),
              content: "Original final payload",
            }),
          }
          const safeMove = SkillSafeMove.make({
            afterFinalRename: Effect.promise(async () => {
              const name = (await fs.readdir(trash)).find((item) => !item.endsWith(".staging"))
              if (!name) throw new Error("final record was not created")
              replacement.path = path.join(trash, name)
              await fs.rename(replacement.path, displaced)
              await fs.mkdir(replacement.path)
              await fs.writeFile(path.join(replacement.path, "marker"), "replacement")
            }),
          })

          const error = yield* remove(
            fsService,
            safeMove,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.flip)
          expect(error).toBeInstanceOf(SkillV2.UnsafePathError)
          expect(yield* Effect.promise(() => fs.readFile(path.join(target, "SKILL.md"), "utf8"))).toContain(
            "Original final payload",
          )
          expect(yield* Effect.promise(() => fs.readFile(path.join(replacement.path, "marker"), "utf8"))).toBe(
            "replacement",
          )
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.join(displaced, "payload")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }),
      ),
    ),
  )

  it.live("does not restore a replacement payload to the skill path", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "payload-race")
          const trash = path.join(state, "skills", "trash")
          const file = path.join(state, "skills", "global.json")
          const record = { path: "" }
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "payload-race", "Original rollback payload"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "payload-race",
              location: AbsolutePath.make(path.join(target, "SKILL.md")),
              content: "Original rollback payload",
            }),
          }
          yield* updateState(fsService, flock, file, id(entry), false)
          const safeMove = SkillSafeMove.make({
            beforeRollback: Effect.promise(async () => {
              const name = (await fs.readdir(trash)).find((item) => !item.endsWith(".staging"))
              if (!name) throw new Error("final record was not created")
              record.path = path.join(trash, name)
              await fs.rename(path.join(record.path, "payload"), path.join(record.path, "original-payload"))
              await fs.mkdir(path.join(record.path, "payload"))
              await fs.writeFile(path.join(record.path, "payload", "SKILL.md"), "replacement")
            }),
          })
          const stateWrite = { failed: false }
          const failure = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "rename",
            pathOrDescriptor: file,
          })
          const filesystem = FSUtil.Service.of({
            ...fsService,
            rename: (from, to) => {
              if (to !== file || stateWrite.failed) return fsService.rename(from, to)
              stateWrite.failed = true
              return Effect.fail(failure)
            },
          })

          const error = yield* remove(filesystem, safeMove, flock, Global.make({ state }), file, entry).pipe(
            Effect.flip,
          )
          expect(error).toMatchObject({ operation: "delete" })
          expect(
            yield* Effect.promise(() =>
              fs.stat(target).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(yield* Effect.promise(() => fs.readFile(path.join(record.path, "payload", "SKILL.md"), "utf8"))).toBe(
            "replacement",
          )
          expect(
            yield* Effect.promise(() => fs.readFile(path.join(record.path, "original-payload", "SKILL.md"), "utf8")),
          ).toContain("Original rollback payload")
          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8")))).toEqual({
            version: 1,
            disabled: [id(entry)],
          })
        }),
      ),
    ),
  )

  it.live("rejects a replaced staging record and retains the displaced payload", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "staging-race")
          const trash = path.join(state, "skills", "trash")
          const displaced = path.join(trash, "displaced-staging")
          const staged = { path: "" }
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "staging-race", "Original staging payload"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "staging-race",
              location: AbsolutePath.make(path.join(target, "SKILL.md")),
              content: "Original staging payload",
            }),
          }
          const safeMove = SkillSafeMove.make({
            beforeFinalizeRename: Effect.promise(async () => {
              const name = (await fs.readdir(trash)).find((item) => item.endsWith(".staging"))
              if (!name) throw new Error("staging record was not created")
              staged.path = path.join(trash, name)
              await fs.rename(staged.path, displaced)
              await fs.mkdir(staged.path)
              await fs.writeFile(path.join(staged.path, "metadata.json"), '{"replacement":true}\n')
              await fs.mkdir(target)
              await fs.writeFile(path.join(target, "SKILL.md"), "new skill")
            }),
          })

          const error = yield* remove(
            fsService,
            safeMove,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.flip)
          expect(error).toMatchObject({ operation: "delete" })
          expect(yield* Effect.promise(() => fs.readFile(path.join(target, "SKILL.md"), "utf8"))).toBe("new skill")
          expect(
            yield* Effect.promise(() => fs.readFile(path.join(displaced, "payload", "SKILL.md"), "utf8")),
          ).toContain("Original staging payload")
          const replacement = staged.path.slice(0, -".staging".length)
          expect(yield* Effect.promise(() => fs.readFile(path.join(replacement, "metadata.json"), "utf8"))).toBe(
            '{"replacement":true}\n',
          )
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.join(replacement, "payload")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(
            (yield* Effect.promise(() => fs.readdir(trash))).filter((item) => !item.endsWith(".staging")),
          ).toHaveLength(2)
        }),
      ),
    ),
  )

  it.live("cleans owned provisional staging after open or stat failure", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const trash = path.join(state, "skills", "trash")
          const cases = [
            { name: "open", hooks: { beforeStagingOpen: Effect.die("injected openAt failure") } },
            { name: "stat", hooks: { beforeStagingStat: Effect.die("injected fstat failure") } },
          ]

          for (const item of cases) {
            const sourceRoot = path.join(tmp.path, item.name, "skills")
            const target = path.join(sourceRoot, item.name)
            yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
            yield* Effect.promise(() => write(sourceRoot, item.name, item.name))
            const entry: Installed = {
              source: SkillV2.DirectorySource.make({
                type: "directory",
                path: AbsolutePath.make(sourceRoot),
                origin: { type: "config-directory", scope: "global", value: sourceRoot },
              }),
              info: SkillV2.Info.make({
                name: item.name,
                location: AbsolutePath.make(path.join(target, "SKILL.md")),
                content: item.name,
              }),
            }

            expect(
              yield* remove(
                fsService,
                SkillSafeMove.make(item.hooks),
                flock,
                Global.make({ state }),
                path.join(state, "skills", `${item.name}.json`),
                entry,
              ).pipe(Effect.flip),
            ).toMatchObject({ operation: "delete" })
            expect(yield* Effect.promise(() => fs.stat(target).then(() => true))).toBe(true)
            expect(yield* Effect.promise(() => fs.readdir(trash).catch(() => []))).toEqual([])
          }
        }),
      ),
    ),
  )

  it.live("does not clean a replacement provisional staging directory", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const liveSafeMove = Context.get(context, SkillSafeMove.Service)
          if (!(yield* liveSafeMove.available())) return
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "provisional")
          const trash = path.join(state, "skills", "trash")
          const replacement = { path: "" }
          const displaced = path.join(trash, "displaced-provisional")
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "provisional", "Provisional"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "provisional",
              location: AbsolutePath.make(path.join(target, "SKILL.md")),
              content: "Provisional",
            }),
          }
          const safeMove = SkillSafeMove.make({
            beforeStagingOpen: Effect.promise(async () => {
              const name = (await fs.readdir(trash)).find((item) => item.endsWith(".staging"))
              if (!name) throw new Error("provisional staging was not created")
              replacement.path = path.join(trash, name)
              await fs.rename(replacement.path, displaced)
              await fs.mkdir(replacement.path)
              await fs.writeFile(path.join(replacement.path, "marker"), "replacement")
            }),
          })

          expect(
            yield* remove(
              fsService,
              safeMove,
              flock,
              Global.make({ state }),
              path.join(state, "skills", "global.json"),
              entry,
            ).pipe(Effect.flip),
          ).toBeInstanceOf(SkillV2.UnsafePathError)
          expect(yield* Effect.promise(() => fs.readFile(path.join(replacement.path, "marker"), "utf8"))).toBe(
            "replacement",
          )
          expect(yield* Effect.promise(() => fs.stat(displaced).then(() => true))).toBe(true)
          expect(yield* Effect.promise(() => fs.stat(target).then(() => true))).toBe(true)
        }),
      ),
    ),
  )

  it.live("rolls back recovery records when metadata, move, finalization, or state cleanup fails", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const global = Global.make({ state })
          const file = path.join(state, "skills", "global.json")
          const failure = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "test",
            pathOrDescriptor: tmp.path,
          })
          const entry = (name: string): Installed => ({
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.join(tmp.path, name, "skills")),
              origin: { type: "config-directory", scope: "global", value: name },
            }),
            info: SkillV2.Info.make({
              name,
              location: AbsolutePath.make(path.join(tmp.path, name, "skills", name, "SKILL.md")),
              content: name,
            }),
          })
          const prepare = (item: Installed) =>
            Effect.promise(async () => {
              await fs.mkdir(path.dirname(item.info.location), { recursive: true })
              await fs.writeFile(item.info.location, `---\nname: ${item.info.name}\n---\n# ${item.info.name}`)
            })
          const cases = [
            {
              name: "metadata",
              filesystem: () => fsService,
              safeMove: SkillSafeMove.Service.of({
                ...portableSafeMove,
                prepare: (input) =>
                  portableSafeMove.prepare(input).pipe(
                    Effect.map((handle) => ({
                      ...handle,
                      stage: (metadata: string) =>
                        handle
                          .stage(metadata)
                          .pipe(
                            Effect.andThen(
                              Effect.fail(
                                new SkillSafeMove.SafeMoveError({ reason: "io", detail: "injected metadata failure" }),
                              ),
                            ),
                          ),
                    })),
                  ),
              }),
            },
            {
              name: "move",
              filesystem: () => fsService,
              safeMove: SkillSafeMove.Service.of({
                ...portableSafeMove,
                prepare: (input) =>
                  portableSafeMove.prepare(input).pipe(
                    Effect.map((handle) => ({
                      ...handle,
                      move: Effect.fail(
                        new SkillSafeMove.SafeMoveError({ reason: "io", detail: "injected move failure" }),
                      ),
                    })),
                  ),
              }),
            },
            {
              name: "final",
              filesystem: () => fsService,
              safeMove: SkillSafeMove.Service.of({
                ...portableSafeMove,
                prepare: (input) =>
                  portableSafeMove.prepare(input).pipe(
                    Effect.map((handle) => ({
                      ...handle,
                      finalize: Effect.fail(
                        new SkillSafeMove.SafeMoveError({ reason: "io", detail: "injected finalization failure" }),
                      ),
                    })),
                  ),
              }),
            },
            {
              name: "defect",
              filesystem: () => fsService,
              safeMove: SkillSafeMove.Service.of({
                ...portableSafeMove,
                prepare: (input) =>
                  portableSafeMove
                    .prepare(input)
                    .pipe(Effect.map((handle) => ({ ...handle, move: Effect.die("rename defect") }))),
              }),
            },
          ]

          for (const item of cases) {
            const installation = entry(item.name)
            yield* prepare(installation)
            const error = yield* remove(item.filesystem(), item.safeMove, flock, global, file, installation).pipe(
              Effect.flip,
            )
            expect(error, item.name).toBeInstanceOf(SkillV2.OperationError)
            expect(error, item.name).toMatchObject({ operation: "delete" })
            expect(
              yield* Effect.promise(() =>
                fs.stat(path.dirname(installation.info.location)).then(
                  () => true,
                  () => false,
                ),
              ),
              item.name,
            ).toBe(true)
          }

          const stateFailure = entry("state")
          yield* prepare(stateFailure)
          const stateID = id(stateFailure)
          yield* updateState(fsService, flock, file, stateID, false)
          const writeFailure = FSUtil.Service.of({
            ...fsService,
            writeFileString: (target, content, options) =>
              target.startsWith(`${file}.`)
                ? Effect.fail(failure)
                : fsService.writeFileString(target, content, options),
          })
          expect(
            yield* remove(writeFailure, portableSafeMove, flock, global, file, stateFailure).pipe(Effect.flip),
          ).toMatchObject({
            operation: "delete",
          })
          expect(yield* Effect.promise(() => fs.stat(path.dirname(stateFailure.info.location)).then(() => true))).toBe(
            true,
          )
          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8")))).toEqual({
            version: 1,
            disabled: [stateID],
          })

          const trash = path.join(state, "skills", "trash")
          expect(yield* Effect.promise(() => fs.readdir(trash).catch(() => []))).toEqual([])
        }),
      ),
    ),
  )

  it.live("restores disabled state when a committed state rename defects or interrupts", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const global = Global.make({ state })
          const cases = ["defect", "interrupt"] as const

          for (const kind of cases) {
            const file = path.join(state, "skills", `${kind}.json`)
            const sourceRoot = path.join(tmp.path, kind, "skills")
            yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, kind), { recursive: true }))
            yield* Effect.promise(() => write(sourceRoot, kind, `State ${kind}`))
            const entry: Installed = {
              source: SkillV2.DirectorySource.make({
                type: "directory",
                path: AbsolutePath.make(sourceRoot),
                origin: { type: "config-directory", scope: "global", value: sourceRoot },
              }),
              info: SkillV2.Info.make({
                name: kind,
                location: AbsolutePath.make(path.join(sourceRoot, kind, "SKILL.md")),
                content: kind,
              }),
            }
            yield* updateState(fsService, flock, file, id(entry), false)
            const previous = yield* Effect.promise(() => fs.readFile(file, "utf8"))
            const stateRename = { failed: false }
            const filesystem = FSUtil.Service.of({
              ...fsService,
              rename: (from, to) => {
                if (to !== file || stateRename.failed) return fsService.rename(from, to)
                stateRename.failed = true
                return fsService
                  .rename(from, to)
                  .pipe(Effect.andThen(kind === "defect" ? Effect.die("post-state defect") : Effect.interrupt))
              },
            })
            const exit = yield* remove(filesystem, portableSafeMove, flock, global, file, entry).pipe(Effect.exit)
            expect(Exit.isFailure(exit), kind).toBe(true)
            if (Exit.isSuccess(exit)) continue
            if (kind === "interrupt") {
              expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
            } else {
              expect(Cause.squash(exit.cause)).toMatchObject({ operation: "delete" })
            }
            expect(yield* Effect.promise(() => fs.readFile(file, "utf8")), kind).toBe(previous)
            expect(
              yield* Effect.promise(() =>
                fs.stat(path.dirname(entry.info.location)).then(
                  () => true,
                  () => false,
                ),
              ),
              kind,
            ).toBe(true)
            expect(
              yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")).catch(() => [])),
            ).toEqual([])
          }
        }),
      ),
    ),
  )

  it.live("preserves a recoverable payload and combined cause when finalization and rollback both fail", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "double"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "double", "Double failure"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "double",
              location: AbsolutePath.make(path.join(sourceRoot, "double", "SKILL.md")),
              content: "double",
            }),
          }
          const rollbackFailure = SkillSafeMove.Service.of({
            ...portableSafeMove,
            prepare: (input) =>
              portableSafeMove.prepare(input).pipe(
                Effect.map((handle) => ({
                  ...handle,
                  finalize: Effect.fail(
                    new SkillSafeMove.SafeMoveError({ reason: "io", detail: "injected finalization failure" }),
                  ),
                  rollback: Effect.fail(
                    new SkillSafeMove.SafeMoveError({ reason: "io", detail: "injected rollback failure" }),
                  ),
                })),
              ),
          })

          const error = yield* remove(
            fsService,
            rollbackFailure,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.flip)
          expect(error).toBeInstanceOf(SkillV2.OperationError)
          expect(error).toMatchObject({ operation: "delete" })
          expect(Cause.isCause(error.cause)).toBe(true)
          if (Cause.isCause(error.cause)) expect(error.cause.reasons).toHaveLength(2)
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.dirname(entry.info.location)).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          const trash = path.join(state, "skills", "trash")
          const records = yield* Effect.promise(() => fs.readdir(trash))
          expect(records).toHaveLength(1)
          expect(records[0].endsWith(".staging")).toBe(true)
          expect(yield* Effect.promise(() => fs.stat(path.join(trash, records[0], "payload")).then(() => true))).toBe(
            true,
          )
          expect(
            JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(trash, records[0], "metadata.json"), "utf8"))),
          ).toMatchObject({ id: id(entry), originalPath: path.dirname(entry.info.location) })
        }),
      ),
    ),
  )

  it.live("restores the original skill and preserves interruption during recovery", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "interrupt"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "interrupt", "Interrupted delete"))
          const entry: Installed = {
            source: SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "global", value: sourceRoot },
            }),
            info: SkillV2.Info.make({
              name: "interrupt",
              location: AbsolutePath.make(path.join(sourceRoot, "interrupt", "SKILL.md")),
              content: "interrupt",
            }),
          }
          const interrupted = SkillSafeMove.Service.of({
            ...portableSafeMove,
            prepare: (input) =>
              portableSafeMove.prepare(input).pipe(Effect.map((handle) => ({ ...handle, finalize: Effect.interrupt }))),
          })
          const exit = yield* remove(
            fsService,
            interrupted,
            flock,
            Global.make({ state }),
            path.join(state, "skills", "global.json"),
            entry,
          ).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) return
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
          expect(Cause.hasFails(exit.cause)).toBe(false)
          expect(Cause.hasDies(exit.cause)).toBe(false)
          expect(yield* Effect.promise(() => fs.stat(path.dirname(entry.info.location)).then(() => true))).toBe(true)
          expect(yield* Effect.promise(() => fs.readdir(path.join(state, "skills", "trash")).catch(() => []))).toEqual(
            [],
          )
        }),
      ),
    ),
  )

  it.live("serializes deletion state cleanup with concurrent enable changes", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("delete-lock-project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "remove"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "remove", "Remove concurrently"))
          const sources = [
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(sourceRoot),
              origin: { type: "config-directory", scope: "project", value: sourceRoot },
            }),
            embedded("keep", "project", "keep"),
          ]
          const first = yield* buildSkill(input)
          const second = yield* buildSkill(input)
          yield* register(first, sources)
          yield* register(second, sources)
          const initial = yield* first.management.list()
          const removed = initial.find((item) => item.name === "remove")!
          const kept = initial.find((item) => item.name === "keep")!
          yield* first.management.setEnabled(removed.id, false)

          yield* Effect.all([first.management.remove(removed.id), second.management.setEnabled(kept.id, false)], {
            concurrency: "unbounded",
          })

          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(input, "project"), "utf8")))).toEqual({
            version: 1,
            disabled: [kept.id],
          })
          expect(
            (yield* runSkill(input, sources)).management.map((item) => ({ name: item.name, status: item.status })),
          ).toEqual([{ name: "keep", status: "disabled" }])
        }),
      ),
    ),
  )

  it.live("rejects a stale enable toggle after a concurrent removal", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("remove-toggle-race"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const context = yield* Layer.build(stateDependencies(input.state))
          const flock = Context.get(context, EffectFlock.Service)
          const removeLocked = yield* Deferred.make<void>()
          const continueRemove = yield* Deferred.make<void>()
          const toggleLocked = yield* Deferred.make<void>()
          const safeMove = SkillSafeMove.Service.of({
            ...portableSafeMove,
            prepare: (prepareInput) =>
              portableSafeMove.prepare(prepareInput).pipe(
                Effect.map((handle) => ({
                  ...handle,
                  stage: (metadata: string) =>
                    Deferred.succeed(removeLocked, undefined).pipe(
                      Effect.andThen(Deferred.await(continueRemove)),
                      Effect.andThen(handle.stage(metadata)),
                    ),
                })),
              ),
          })
          const observedFlock = EffectFlock.Service.of({
            ...flock,
            withLock: Function.dual(
              (args) => Effect.isEffect(args[0]),
              <A, E, R>(body: Effect.Effect<A, E, R>, key: string, dir?: string) =>
                Deferred.succeed(toggleLocked, undefined).pipe(Effect.andThen(flock.withLock(body, key, dir))),
            ),
          })
          const sourceRoot = path.join(tmp.path, "skills")
          const target = path.join(sourceRoot, "shared")
          yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "shared", "Shared skill"))
          const source = SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(sourceRoot),
            origin: { type: "config-directory", scope: "project", value: sourceRoot },
          })
          const first = yield* buildSkill({ ...input, safeMove })
          const second = yield* buildSkill({ ...input, flock: observedFlock })
          yield* register(first, [source])
          yield* register(second, [source])
          const installed = (yield* first.management.list())[0]

          const removal = yield* first.management.remove(installed.id).pipe(Effect.exit, Effect.forkScoped)
          yield* Deferred.await(removeLocked)
          const toggle = yield* second.management.setEnabled(installed.id, false).pipe(Effect.exit, Effect.forkScoped)
          yield* Deferred.await(toggleLocked)
          yield* Deferred.succeed(continueRemove, undefined)
          const [removalExit, toggleExit] = yield* Effect.all([Fiber.join(removal), Fiber.join(toggle)])

          expect(Exit.isSuccess(removalExit)).toBe(true)
          expect(Exit.isFailure(toggleExit)).toBe(true)
          expect(Exit.isFailure(toggleExit) ? Cause.squash(toggleExit.cause) : undefined).toBeInstanceOf(
            SkillV2.NotFoundError,
          )
          yield* Effect.promise(() => fs.mkdir(target))
          yield* Effect.promise(() => write(sourceRoot, "shared", "Reinstalled skill"))
          expect((yield* second.management.list()).map((item) => ({ id: item.id, status: item.status }))).toEqual([
            { id: installed.id, status: "active" },
          ])
        }),
      ),
    ),
  )

  it.live("refreshes local discovery across live services and external deletion", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("fresh-delete-project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const sourceRoot = path.join(tmp.path, "skills")
          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "shared"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "shared", "Shared skill"))
          const source = SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(sourceRoot),
            origin: { type: "config-directory", scope: "project", value: sourceRoot },
          })
          const first = yield* buildSkill(input)
          const second = yield* buildSkill(input)
          yield* register(first, [source])
          yield* register(second, [source])
          const shared = (yield* first.management.list())[0]
          expect((yield* second.management.list()).map((item) => item.name)).toEqual(["shared"])

          const concurrent = yield* Effect.all(
            [
              first.management.remove(shared.id).pipe(Effect.exit),
              second.management.remove(shared.id).pipe(Effect.exit),
            ],
            { concurrency: "unbounded" },
          )
          expect(concurrent.filter(Exit.isSuccess)).toHaveLength(1)
          const rejected = concurrent.find(Exit.isFailure)
          expect(rejected && Exit.isFailure(rejected) ? Cause.squash(rejected.cause) : undefined).toBeInstanceOf(
            SkillV2.NotFoundError,
          )
          expect(yield* second.management.list()).toEqual([])
          expect(yield* second.list()).toEqual([])
          expect(yield* second.management.remove(shared.id).pipe(Effect.flip)).toBeInstanceOf(SkillV2.NotFoundError)

          yield* Effect.promise(() => fs.mkdir(path.join(sourceRoot, "external"), { recursive: true }))
          yield* Effect.promise(() => write(sourceRoot, "external", "External deletion"))
          const external = (yield* second.management.list())[0]
          expect(external.name).toBe("external")
          yield* Effect.promise(() => fs.rm(path.join(sourceRoot, "external"), { recursive: true }))
          expect(yield* first.management.list()).toEqual([])
          expect(yield* second.list()).toEqual([])
          expect(yield* second.management.remove(external.id).pipe(Effect.flip)).toBeInstanceOf(SkillV2.NotFoundError)
        }),
      ),
    ),
  )

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
          expect(
            managed.map((item) => ({ description: item.description, name: item.name, status: item.status })),
          ).toEqual([
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

  it.live("serializes concurrent updates from two live services without losing IDs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const input: SkillLayerInput = {
            state: path.join(tmp.path, "state"),
            directory: path.join(tmp.path, "repo"),
            projectID: Project.ID.make("shared-project"),
            projectRoot: path.join(tmp.path, "repo"),
          }
          const sources = [embedded("alpha", "project", "alpha"), embedded("beta", "project", "beta")]
          const first = yield* buildSkill(input)
          const second = yield* buildSkill(input)
          yield* register(first, sources)
          yield* register(second, sources)
          const ids = (yield* first.management.list()).map((item) => item.id)

          yield* Effect.all([first.management.setEnabled(ids[0], false), second.management.setEnabled(ids[1], false)], {
            concurrency: "unbounded",
          })

          expect(JSON.parse(yield* Effect.promise(() => fs.readFile(stateFile(input, "project"), "utf8")))).toEqual({
            version: 1,
            disabled: ids.toSorted(),
          })
        }),
      ),
    ),
  )

  it.live("maps an unwritable lock directory defect to OperationError", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        if (process.platform === "win32") return Effect.void
        const input: SkillLayerInput = {
          state: path.join(tmp.path, "state"),
          directory: path.join(tmp.path, "repo"),
          projectID: Project.ID.make("project"),
          projectRoot: path.join(tmp.path, "repo"),
        }
        return Effect.gen(function* () {
          const skill = yield* buildSkill(input)
          yield* register(skill, [embedded("local", "project", "local")])
          const id = (yield* skill.management.list())[0].id
          yield* Effect.promise(async () => {
            await fs.mkdir(input.state, { recursive: true })
            await fs.chmod(input.state, 0o500)
          })
          yield* Effect.addFinalizer(() => Effect.promise(() => fs.chmod(input.state, 0o700)).pipe(Effect.ignore))

          const exit = yield* skill.management.setEnabled(id, false).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) return
          expect(Cause.hasFails(exit.cause)).toBe(true)
          expect(Cause.hasDies(exit.cause)).toBe(false)
          expect(Cause.squash(exit.cause)).toBeInstanceOf(SkillV2.OperationError)
          expect(Cause.squash(exit.cause)).toMatchObject({ operation: "write" })
        })
      }),
    ),
  )

  it.live("maps a lock release defect to OperationError", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const state = path.join(tmp.path, "state")
          const context = yield* Layer.build(stateDependencies(state))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const file = path.join(state, "skills", "global.json")
          const lockMetadata = path.join(state, "locks", `${Hash.fast(file)}.lock`, "meta.json")
          const releaseFailure = FSUtil.Service.of({
            ...fsService,
            rename: (from, to) =>
              fsService.rename(from, to).pipe(Effect.andThen(fsService.remove(lockMetadata, { force: true }))),
          })

          const exit = yield* updateState(
            releaseFailure,
            flock,
            file,
            SkillV2.ManagementID.make("release-failure"),
            false,
          ).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) return
          expect(Cause.hasFails(exit.cause)).toBe(true)
          expect(Cause.hasDies(exit.cause)).toBe(false)
          expect(Cause.squash(exit.cause)).toBeInstanceOf(SkillV2.OperationError)
          expect(Cause.squash(exit.cause)).toMatchObject({ operation: "write" })
        }),
      ),
    ),
  )

  it.live("preserves interruption while waiting for the state lock", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const context = yield* Layer.build(stateDependencies(path.join(tmp.path, "state")))
          const fsService = Context.get(context, FSUtil.Service)
          const contenderStarted = yield* Deferred.make<void>()
          const contenderRelease = yield* Deferred.make<void>()
          const withLock: EffectFlock.Interface["withLock"] = Function.dual(
            (args) => Effect.isEffect(args[0]),
            <A, E, R>(body: Effect.Effect<A, E, R>, _key: string, _dir?: string) =>
              Deferred.succeed(contenderStarted, undefined).pipe(
                Effect.andThen(Deferred.await(contenderRelease)),
                Effect.andThen(body),
              ),
          )
          const flock = {
            acquire: () => Effect.never,
            withLock,
          } satisfies EffectFlock.Interface
          const update = yield* updateState(
            fsService,
            flock,
            path.join(tmp.path, "state", "skills", "global.json"),
            SkillV2.ManagementID.make("blocked"),
            false,
          ).pipe(Effect.forkScoped)
          yield* Deferred.await(contenderStarted)

          yield* Fiber.interrupt(update)
          const exit = yield* Fiber.await(update)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) return
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
          expect(Cause.hasFails(exit.cause)).toBe(false)
          expect(Cause.hasDies(exit.cause)).toBe(false)
          expect(Cause.squash(exit.cause)).not.toBeInstanceOf(SkillV2.OperationError)
          yield* Deferred.succeed(contenderRelease, undefined)
        }),
      ),
    ),
  )

  it.live("keeps old state and cleans temp files when atomic writes fail", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const context = yield* Layer.build(stateDependencies(path.join(tmp.path, "state")))
          const fsService = Context.get(context, FSUtil.Service)
          const flock = Context.get(context, EffectFlock.Service)
          const file = path.join(tmp.path, "state", "skills", "global.json")
          const oldID = SkillV2.ManagementID.make("old")
          const newID = SkillV2.ManagementID.make("new")
          const previous = JSON.stringify({ version: 1, disabled: [oldID] })
          const failure = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "test",
            pathOrDescriptor: file,
          })
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, previous)
          })

          const writeFailure = FSUtil.Service.of({
            ...fsService,
            writeFileString: (target, content, options) =>
              target.startsWith(`${file}.`)
                ? fsService.writeFileString(target, content, options).pipe(Effect.andThen(Effect.fail(failure)))
                : fsService.writeFileString(target, content, options),
          })
          expect(yield* updateState(writeFailure, flock, file, newID, false).pipe(Effect.flip)).toBeInstanceOf(
            SkillV2.OperationError,
          )
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(previous)
          expect(
            (yield* Effect.promise(() => fs.readdir(path.dirname(file)))).filter((name) => name.endsWith(".tmp")),
          ).toEqual([])

          const renameFailure = FSUtil.Service.of({
            ...fsService,
            rename: (from, to) => (to === file ? Effect.fail(failure) : fsService.rename(from, to)),
          })
          expect(yield* updateState(renameFailure, flock, file, newID, false).pipe(Effect.flip)).toBeInstanceOf(
            SkillV2.OperationError,
          )
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(previous)
          expect(
            (yield* Effect.promise(() => fs.readdir(path.dirname(file)))).filter((name) => name.endsWith(".tmp")),
          ).toEqual([])

          yield* updateState(fsService, flock, file, newID, false)
          expect((yield* Effect.promise(() => fs.stat(file))).mode & 0o777).toBe(0o600)
        }),
      ),
    ),
  )

  it.live("refreshes a live location after another live location changes global state", () =>
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
          const firstSkill = yield* buildSkill(first)
          const secondSkill = yield* buildSkill(second)
          yield* register(firstSkill, sources)
          yield* register(secondSkill, sources)
          const initial = yield* firstSkill.management.list()
          expect(initial[0].status).toBe("active")

          yield* secondSkill.management.setEnabled(initial[0].id, false)
          expect((yield* firstSkill.management.list())[0].status).toBe("disabled")
          expect(yield* firstSkill.list()).toEqual([])
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
          const skill = yield* buildSkill(input)
          yield* register(skill, [embedded("known", "project", "known")])
          const removeError = yield* skill.management.remove(SkillV2.ManagementID.make("missing")).pipe(Effect.flip)
          expect(removeError).toBeInstanceOf(SkillV2.NotFoundError)
          expect(
            yield* Effect.promise(() =>
              fs.stat(path.join(input.state, "skills")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
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

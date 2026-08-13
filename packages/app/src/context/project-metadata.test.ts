import { describe, expect, test } from "bun:test"
import {
  automaticProjectColorPatch,
  createProjectMetadataLocalWriter,
  createProjectMetadataWriter,
  editProjectMetadataPatch,
  mergeProjectMetadata,
  needsAutomaticProjectColor,
  persistProjectMetadata,
  type ProjectMetadata,
  projectMetadataErrorMessage,
  renameProjectMetadataPatch,
} from "./project-metadata"
import { ServerScope } from "@/utils/server-scope"

describe("mergeProjectMetadata", () => {
  test("merges icon and commands field by field", () => {
    const result = mergeProjectMetadata(
      {
        id: "project-1",
        worktree: "/project",
        name: "server",
        icon: { url: "server.png", override: "server-custom.png", color: "blue" },
        commands: { start: "old" },
      },
      {
        name: "local",
        icon: { color: "mint" },
        commands: { start: "bun dev" },
      },
    )

    expect(result).toEqual({
      id: "project-1",
      worktree: "/project",
      name: "local",
      icon: { url: "server.png", override: "server-custom.png", color: "mint" },
      commands: { start: "bun dev" },
    })
  })

  test("preserves explicit empty-string overrides", () => {
    const result = mergeProjectMetadata(
      {
        name: "server",
        icon: { url: "server.png", override: "custom.png", color: "blue" },
        commands: { start: "bun dev" },
      },
      {
        name: "",
        icon: { override: "", color: "" },
        commands: { start: "" },
      },
    )

    expect(result).toEqual({
      name: "",
      icon: { url: "server.png", override: "", color: "" },
      commands: { start: "" },
    })
  })

  test("does not treat legacy undefined values as local overrides", () => {
    const result = mergeProjectMetadata(
      { name: "server", icon: { color: "blue" }, commands: { start: "bun dev" } },
      { name: undefined, icon: { color: undefined }, commands: { start: undefined } },
    )

    expect(result).toEqual({ name: "server", icon: { color: "blue" }, commands: { start: "bun dev" } })
  })
})

describe("persistProjectMetadata", () => {
  test("updates a V1 server first, then the projection, then the local mirror", async () => {
    const calls: string[] = []
    const project = { id: "project-1", worktree: "/project", name: "before", icon: { url: "server.png" } }
    const patch = { name: "after", icon: { color: "mint" } }

    const result = await persistProjectMetadata({
      protocol: "v1",
      project,
      patch,
      updateServer: async (input) => {
        calls.push("server")
        expect(input).toEqual({ projectID: "project-1", directory: "/project", patch })
        return { ...project, name: "after" }
      },
      writeLocal: async (next) => {
        calls.push("local")
        expect(next).toBe(patch)
      },
      updateProjection: async (next) => {
        calls.push("projection")
        expect(next).toEqual({ ...project, name: "after", icon: { url: "server.png", color: "mint" } })
      },
    })

    expect(calls).toEqual(["server", "projection", "local"])
    expect(result).toEqual({ ...project, name: "after", icon: { url: "server.png", color: "mint" } })
  })

  test("does not write locally when a V1 server update fails", async () => {
    const calls: string[] = []

    await expect(
      persistProjectMetadata({
        protocol: "v1",
        project: { id: "project-1", worktree: "/project", name: "before" },
        patch: { name: "after" },
        updateServer: async () => {
          calls.push("server")
          throw new Error("server rejected update")
        },
        writeLocal: async () => {
          calls.push("local")
        },
        updateProjection: async () => {
          calls.push("projection")
        },
      }),
    ).rejects.toThrow("server rejected update")

    expect(calls).toEqual(["server"])
  })

  test("treats an empty V1 response as a failure", async () => {
    const calls: string[] = []

    await expect(
      persistProjectMetadata({
        protocol: "v1",
        project: { id: "project-1", worktree: "/project" },
        patch: { name: "after" },
        updateServer: async () => {
          calls.push("server")
          return undefined
        },
        writeLocal: async () => {
          calls.push("local")
        },
        updateProjection: async () => {
          calls.push("projection")
        },
      }),
    ).rejects.toThrow("server did not confirm")

    expect(calls).toEqual(["server"])
  })

  test("writes V2 metadata locally without calling the V1 server", async () => {
    const calls: string[] = []
    const result = await persistProjectMetadata({
      protocol: "v2",
      project: { id: "project-1", worktree: "/project", icon: { url: "server.png" } },
      patch: { icon: { color: "mint" } },
      updateServer: async () => {
        calls.push("server")
        return undefined
      },
      writeLocal: async () => {
        calls.push("local")
      },
      updateProjection: async () => {
        calls.push("projection")
      },
    })

    expect(calls).toEqual(["local", "projection"])
    expect(result.icon).toEqual({ url: "server.png", color: "mint" })
  })

  test("writes global and id-less projects locally even on V1", async () => {
    const calls: string[] = []
    const save = (project: { id?: string; worktree: string }) =>
      persistProjectMetadata({
        protocol: "v1",
        project,
        patch: { name: "local" },
        updateServer: async () => {
          calls.push("server")
          return undefined
        },
        writeLocal: async () => {
          calls.push(`local:${project.id ?? "missing"}`)
        },
        updateProjection: async () => {
          calls.push(`projection:${project.id ?? "missing"}`)
        },
      })

    await save({ id: "global", worktree: "/global" })
    await save({ worktree: "/local" })

    expect(calls).toEqual(["local:global", "projection:global", "local:missing", "projection:missing"])
  })

  test("does not update a V2 projection when local persistence fails", async () => {
    const base = {
      protocol: "v2" as const,
      project: { worktree: "/project" },
      patch: { name: "local" },
      updateServer: async () => undefined,
    }
    const calls: string[] = []

    await expect(
      persistProjectMetadata({
        ...base,
        writeLocal: async () => {
          calls.push("local")
          throw new Error("local failed")
        },
        updateProjection: async () => {
          calls.push("projection")
        },
      }),
    ).rejects.toThrow("local failed")

    expect(calls).toEqual(["local"])
  })

  test("keeps the server-confirmed V1 projection when its local mirror fails", async () => {
    const project: ProjectMetadata = { id: "project-1", worktree: "/project", name: "before" }
    let projected = project

    await expect(
      persistProjectMetadata({
        protocol: "v1",
        project,
        patch: { name: "after" },
        updateServer: async () => ({ ...project, name: "after" }),
        updateProjection: (next) => {
          projected = next
        },
        writeLocal: async () => {
          throw new Error("local failed")
        },
      }),
    ).rejects.toThrow("local failed")

    expect(projected.name).toBe("after")
  })

  test("persists V2 metadata before updating the projection", async () => {
    const calls: string[] = []

    await expect(
      persistProjectMetadata({
        protocol: "v2",
        project: { worktree: "/project" },
        patch: { name: "local" },
        updateServer: async () => undefined,
        writeLocal: async () => {
          calls.push("local")
        },
        updateProjection: async () => {
          calls.push("projection")
          throw new Error("projection failed")
        },
      }),
    ).rejects.toThrow("projection failed")

    expect(calls).toEqual(["local", "projection"])
  })
})

describe("createProjectMetadataWriter", () => {
  test("routes edit, rename, and automatic-color patches through the same writer", async () => {
    const project = { id: "project-1", worktree: "/project" }
    const local: unknown[] = []
    const projected: unknown[] = []
    let serverCalls = 0
    const writer = createProjectMetadataWriter({
      target: () => ({
        scope: ServerScope.local,
        protocol: "v2",
        readProject: () => project,
        updateServer: async () => {
          serverCalls += 1
          return project
        },
        writeLocal: async (_project, patch) => {
          local.push(patch)
        },
        updateProjection: async (next) => {
          projected.push(next)
        },
      }),
    })
    const patches = [
      editProjectMetadataPatch({ name: "Edited", color: undefined, override: undefined, start: "bun dev" }),
      renameProjectMetadataPatch("Renamed"),
      automaticProjectColorPatch("mint"),
    ]

    for (const patch of patches) await writer(project, patch)

    expect(serverCalls).toBe(0)
    expect(local).toEqual(patches)
    expect(projected).toEqual([
      {
        ...project,
        name: "Edited",
        icon: { color: "", override: "" },
        commands: { start: "bun dev" },
      },
      { ...project, name: "Renamed" },
      { ...project, icon: { color: "mint" } },
    ])
  })

  test("serializes automatic and user colors across writer instances and normalized worktrees", async () => {
    const initial = { id: "project-1", worktree: "C:\\repo" }
    let current = initial as typeof initial & { icon?: { color?: string } }
    let releaseAutomatic: ((project: typeof current) => void) | undefined
    const automaticResult = new Promise<typeof current>((resolve) => {
      releaseAutomatic = resolve
    })
    const calls: string[] = []
    const createWriter = () =>
      createProjectMetadataWriter({
        target: () => ({
          scope: ServerScope.local,
          protocol: "v1",
          readProject: () => current,
          updateServer: async (project, update) => {
            const color = update.patch.icon?.color
            calls.push(color ?? "missing")
            if (color === "mint") return automaticResult
            return { ...project, icon: { ...project.icon, ...update.patch.icon } }
          },
          writeLocal: async () => {},
          updateProjection: (project) => {
            current = project
          },
        }),
      })
    const automaticWriter = createWriter()
    const userWriter = createWriter()

    const automatic = automaticWriter(initial, automaticProjectColorPatch("mint"))
    await Promise.resolve()
    const user = userWriter(
      { ...initial, worktree: "C:/repo" },
      editProjectMetadataPatch({
        name: "",
        color: "purple",
        override: undefined,
        start: "",
      }),
    )
    await Promise.resolve()

    expect(calls).toEqual(["mint"])
    releaseAutomatic?.({ ...initial, icon: { color: "mint" } })
    await automatic
    await user

    expect(calls).toEqual(["mint", "purple"])
    expect(current.icon?.color).toBe("purple")
  })

  test("rechecks automatic color eligibility when its shared queue turn begins", async () => {
    const initial = { id: "project-1", worktree: "/project" }
    let current = initial as typeof initial & { icon?: { color?: string } }
    let releaseUser: ((project: typeof current) => void) | undefined
    const userResult = new Promise<typeof current>((resolve) => {
      releaseUser = resolve
    })
    const calls: string[] = []
    const createWriter = () =>
      createProjectMetadataWriter({
        target: () => ({
          scope: ServerScope.local,
          protocol: "v1",
          readProject: () => current,
          updateServer: async (project, update) => {
            const color = update.patch.icon?.color
            calls.push(color ?? "missing")
            if (color === "purple") return userResult
            return { ...project, icon: { ...project.icon, ...update.patch.icon } }
          },
          writeLocal: async () => {},
          updateProjection: (project) => {
            current = project
          },
        }),
      })
    const userWriter = createWriter()
    const automaticWriter = createWriter()

    const user = userWriter(
      initial,
      editProjectMetadataPatch({
        name: "",
        color: "purple",
        override: undefined,
        start: "",
      }),
    )
    await Promise.resolve()
    const automatic = automaticWriter(initial, automaticProjectColorPatch("mint"), {
      shouldWrite: needsAutomaticProjectColor,
    })

    releaseUser?.({ ...initial, icon: { color: "purple" } })
    await user
    await automatic

    expect(calls).toEqual(["purple"])
    expect(current.icon?.color).toBe("purple")
  })

  test("keeps a delayed write bound to the server captured at invocation", async () => {
    const protocol = Promise.withResolvers<"v1">()
    const contexts = {
      a: {
        scope: "server-a" as ReturnType<typeof ServerScope.fromServerKey>,
        protocol: protocol.promise,
        project: { id: "project-a", worktree: "/shared" },
        calls: [] as string[],
      },
      b: {
        scope: "server-b" as ReturnType<typeof ServerScope.fromServerKey>,
        protocol: Promise.resolve("v1" as const),
        project: { id: "project-b", worktree: "/shared" },
        calls: [] as string[],
      },
    }
    let active = contexts.a
    const writer = createProjectMetadataWriter({
      target: () => {
        const context = active
        return {
          scope: context.scope,
          protocol: context.protocol,
          readProject: () => context.project,
          updateServer: async (project) => {
            context.calls.push("server")
            return project
          },
          updateProjection: () => {
            context.calls.push("projection")
          },
          writeLocal: () => {
            context.calls.push("local")
          },
        }
      },
    })

    const save = writer(contexts.a.project, renameProjectMetadataPatch("Saved on A"))
    active = contexts.b
    protocol.resolve("v1")
    await save

    expect(contexts.a.calls).toEqual(["server", "projection", "local"])
    expect(contexts.b.calls).toEqual([])
  })

  test("uses independent queues for different captured server targets", async () => {
    const delayed = Promise.withResolvers<{ id: string; worktree: string }>()
    const contexts = {
      a: {
        scope: "server-a" as ReturnType<typeof ServerScope.fromServerKey>,
        project: { id: "project-a", worktree: "/shared" },
        calls: [] as string[],
      },
      b: {
        scope: "server-b" as ReturnType<typeof ServerScope.fromServerKey>,
        project: { id: "project-b", worktree: "/shared" },
        calls: [] as string[],
      },
    }
    let active = contexts.a
    const writer = createProjectMetadataWriter({
      target: () => {
        const context = active
        return {
          scope: context.scope,
          protocol: "v1" as const,
          readProject: () => context.project,
          updateServer: async (project) => {
            context.calls.push("server")
            if (context === contexts.a) return delayed.promise
            return project
          },
          updateProjection: () => {
            context.calls.push("projection")
          },
          writeLocal: () => {
            context.calls.push("local")
          },
        }
      },
    })

    const saveA = writer(contexts.a.project, renameProjectMetadataPatch("Saved on A"))
    await Promise.resolve()
    active = contexts.b
    await writer(contexts.b.project, renameProjectMetadataPatch("Saved on B"))

    expect(contexts.a.calls).toEqual(["server"])
    expect(contexts.b.calls).toEqual(["server", "projection", "local"])

    delayed.resolve(contexts.a.project)
    await saveA

    expect(contexts.a.calls).toEqual(["server", "projection", "local"])
    expect(contexts.b.calls).toEqual(["server", "projection", "local"])
  })

  test("does not let a failed earlier save overwrite a later successful projection", async () => {
    const initial: ProjectMetadata = { worktree: "/project", name: "before" }
    let current = initial
    const writes = Promise.withResolvers<void>()
    const writer = createProjectMetadataWriter({
      target: () => ({
        scope: ServerScope.local,
        protocol: "v2" as const,
        readProject: () => current,
        updateServer: async () => undefined,
        updateProjection: (project) => {
          current = project
        },
        writeLocal: async (_project, patch) => {
          if (patch.name === "first") return writes.promise
        },
      }),
    })

    const first = writer(initial, { name: "first" })
    const second = writer(initial, { name: "second" })
    await Promise.resolve()
    writes.reject(new Error("first failed"))

    await expect(first).rejects.toThrow("first failed")
    await second

    expect(current.name).toBe("second")
  })

  test("preserves a newer V2 server projection that arrives while local persistence is pending", async () => {
    const initial: ProjectMetadata = { worktree: "/project", name: "before", commands: { start: "old" } }
    let current = initial
    const write = Promise.withResolvers<void>()
    const writer = createProjectMetadataWriter({
      target: () => ({
        scope: ServerScope.local,
        protocol: "v2" as const,
        readProject: () => current,
        updateServer: async () => undefined,
        updateProjection: (project) => {
          current = project
        },
        writeLocal: () => write.promise,
      }),
    })

    const save = writer(initial, { name: "local" })
    await Promise.resolve()
    current = { ...current, commands: { start: "from-server-event" } }
    write.resolve()
    await save

    expect(current).toEqual({ ...initial, name: "local", commands: { start: "from-server-event" } })
  })
})

describe("createProjectMetadataLocalWriter", () => {
  test("does not produce a legacy icon partial write when metadata persistence fails", async () => {
    const calls: string[] = []
    const project = {
      meta: async () => {
        calls.push("meta")
        throw new Error("metadata failed")
      },
      icon: async () => {
        calls.push("icon")
      },
    }
    const writeLocal = createProjectMetadataLocalWriter(project)

    await expect(writeLocal({ worktree: "/project" }, { icon: { override: "custom.png" } })).rejects.toThrow(
      "metadata failed",
    )

    expect(calls).toEqual(["meta"])
  })
})

describe("projectMetadataErrorMessage", () => {
  test("uses known messages and hides unknown values", () => {
    expect(projectMetadataErrorMessage(new Error("save failed"), "Request failed")).toBe("save failed")
    expect(projectMetadataErrorMessage({ data: { message: "server failed" } }, "Request failed")).toBe("server failed")
    expect(projectMetadataErrorMessage({ secret: "raw object" }, "Request failed")).toBe("Request failed")
  })
})

describe("needsAutomaticProjectColor", () => {
  test("distinguishes a missing color from an explicit clear", () => {
    expect(needsAutomaticProjectColor({})).toBe(true)
    expect(needsAutomaticProjectColor({ icon: { color: "" } })).toBe(false)
    expect(needsAutomaticProjectColor({ icon: { override: "custom.png" } })).toBe(false)
    expect(needsAutomaticProjectColor({ icon: { url: "server.png" } })).toBe(false)
  })
})

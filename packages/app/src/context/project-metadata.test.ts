import { describe, expect, test } from "bun:test"
import {
  automaticProjectColorPatch,
  createProjectMetadataWriter,
  editProjectMetadataPatch,
  mergeProjectMetadata,
  needsAutomaticProjectColor,
  persistProjectMetadata,
  projectMetadataErrorMessage,
  renameProjectMetadataPatch,
} from "./project-metadata"

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

    expect(calls).toEqual(["projection", "local"])
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

    expect(calls).toEqual(["projection:global", "local:global", "projection:missing", "local:missing"])
  })

  test("propagates local failures after updating the projection", async () => {
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

    expect(calls).toEqual(["projection", "local"])
  })

  test("does not write locally when projection update fails", async () => {
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

    expect(calls).toEqual(["projection"])
  })
})

describe("createProjectMetadataWriter", () => {
  test("routes edit, rename, and automatic-color patches through the same writer", async () => {
    const project = { id: "project-1", worktree: "/project" }
    const local: unknown[] = []
    const projected: unknown[] = []
    let serverCalls = 0
    const writer = createProjectMetadataWriter({
      protocol: () => "v2",
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
})

describe("projectMetadataErrorMessage", () => {
  test("uses known messages and hides unknown values", () => {
    expect(projectMetadataErrorMessage(new Error("save failed"), "Request failed")).toBe("save failed")
    expect(projectMetadataErrorMessage({ data: { message: "server failed" } }, "Request failed")).toBe(
      "server failed",
    )
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

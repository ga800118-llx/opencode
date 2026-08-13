import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type {
  McpListInput,
  McpResourceCatalogInput,
  SessionApi,
  SessionInfo,
  SessionListInput,
} from "@opencode-ai/client/promise"
import { QueryClient } from "@tanstack/solid-query"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import { estimateRootSessionTotal, loadRootSessions } from "./global-sync/session-load"
import {
  createWorkspaceReadinessController,
  loadActiveSessionsQuery,
  loadMcpQuery,
  loadMcpResourcesQuery,
  refreshWorkspaceReadinessOnAgentChange,
  refreshWorkspaceReadinessOnReconnect,
  seedActiveSessionStatuses,
} from "./server-sync"
import { ServerScope } from "@/utils/server-scope"
import { createServerSession } from "./server-session"
import type { ServerApi } from "@/utils/server"
import { createDraftReadinessController } from "./tabs"
import type { ServerConnection } from "./server"

type McpApi = ServerApi["mcp"]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("workspace readiness", () => {
  test("shares one bootstrap for concurrent normalized directory requests", async () => {
    const bootstrap = deferred<{ status: "ready"; errors: readonly Error[] }>()
    let calls = 0
    const controller = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: () => {
        calls++
        return bootstrap.promise
      },
    })

    const first = controller.ensureReady("/project/")
    const second = controller.ensureReady("/project")

    expect(first).toBe(second)
    expect(calls).toBe(1)
    expect(controller.readiness("/project/")).toBe("initializing")

    bootstrap.resolve({ status: "ready", errors: [] })
    expect(await first).toBe("ready")
    expect(controller.readiness("/project")).toBe("ready")
  })

  test("marks critical failures as failed and retries on the next call", async () => {
    let calls = 0
    const controller = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        calls++
        if (calls === 1) throw new Error("project identity failed")
        return { status: "ready" as const, errors: [] }
      },
    })

    await expect(controller.ensureReady("/project")).rejects.toThrow("project identity failed")
    expect(controller.readiness("/project")).toBe("failed")
    expect(await controller.ensureReady("/project")).toBe("ready")
    expect(controller.readiness("/project")).toBe("ready")
    expect(calls).toBe(2)
  })

  test("merges automatic refresh with readiness and records the result for later consumers", async () => {
    const bootstrap = deferred<{ status: "ready"; errors: readonly Error[] }>()
    let calls = 0
    const controller = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: () => {
        calls++
        return bootstrap.promise
      },
    })

    const automatic = controller.refresh("C:\\project\\")
    const readiness = controller.ensureReady("C:/project")

    expect(readiness).toBe(automatic)
    expect(calls).toBe(1)
    bootstrap.resolve({ status: "ready", errors: [] })
    expect(await automatic).toBe("ready")
    expect(await controller.ensureReady("C:/project/")).toBe("ready")
    expect(calls).toBe(1)
  })

  test("refreshes a settled workspace while sharing the refresh with readiness callers", async () => {
    const refresh = deferred<{ status: "degraded"; errors: readonly Error[] }>()
    let calls = 0
    const controller = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        calls++
        if (calls === 1) return { status: "ready", errors: [] }
        return refresh.promise
      },
    })

    expect(await controller.ensureReady("/project")).toBe("ready")
    const automatic = controller.refresh("/project/")
    const readiness = controller.ensureReady("/project")
    expect(readiness).toBe(automatic)
    expect(calls).toBe(2)

    refresh.resolve({ status: "degraded", errors: [new Error("provider failed")] })
    expect(await automatic).toBe("degraded")
    expect(controller.readiness("/project")).toBe("degraded")
  })

  test("refreshes a ready workspace on reconnect and shares one config request with a pending draft", async () => {
    const reconnect = deferred<{ status: "ready"; errors: readonly Error[] }>()
    let configRequests = 0
    const readiness = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        configRequests++
        if (configRequests === 1) return { status: "ready", errors: [] }
        return reconnect.promise
      },
    })
    const created: string[] = []
    const drafts = createDraftReadinessController({
      ensureReady: (_, directory) => readiness.ensureReady(directory),
      createDraft: async (draft) => {
        created.push(draft.directory)
        return { type: "draft", draftID: "draft-reconnect", ...draft }
      },
      openLegacy: async () => {},
      onError() {},
    })

    expect(await readiness.ensureReady("C:/project")).toBe("ready")
    const reconnecting = refreshWorkspaceReadinessOnReconnect({
      directories: ["C:\\project\\"],
      active: () => true,
      refresh: readiness.refresh,
    })[0]!
    const direct = readiness.ensureReady("C:/project")
    const draft = drafts.newDraft({
      server: "sidecar" as ServerConnection.Key,
      directory: "C:/project/",
    })

    await Promise.resolve()
    expect(direct).toBe(reconnecting)
    expect(configRequests).toBe(2)
    expect(created).toEqual([])

    reconnect.resolve({ status: "ready", errors: [] })
    expect(await direct).toBe("ready")
    expect(await draft).toMatchObject({ type: "draft", directory: "C:/project/" })
    expect(configRequests).toBe(2)
    expect(created).toEqual(["C:/project/"])
  })

  test("keeps reconnect failures retryable for the next draft", async () => {
    const reconnect = deferred<{ status: "ready"; errors: readonly Error[] }>()
    let configRequests = 0
    const readiness = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        configRequests++
        if (configRequests === 1 || configRequests === 3) return { status: "ready", errors: [] }
        return reconnect.promise
      },
    })
    const created: string[] = []
    const errors: unknown[] = []
    const drafts = createDraftReadinessController({
      ensureReady: (_, directory) => readiness.ensureReady(directory),
      createDraft: async (draft) => {
        created.push(draft.directory)
        return { type: "draft", draftID: "draft-retry", ...draft }
      },
      openLegacy: async () => {},
      onError: (error) => errors.push(error),
    })

    expect(await readiness.ensureReady("/project")).toBe("ready")
    const reconnecting = refreshWorkspaceReadinessOnReconnect({
      directories: ["/project"],
      active: () => true,
      refresh: readiness.refresh,
    })[0]!
    const blocked = drafts.newDraft({ server: "sidecar" as ServerConnection.Key, directory: "/project" })

    reconnect.reject(new Error("config unavailable after reconnect"))
    await expect(reconnecting).rejects.toThrow("config unavailable after reconnect")
    expect(await blocked).toBeUndefined()
    expect(readiness.readiness("/project")).toBe("failed")
    expect(configRequests).toBe(2)
    expect(created).toEqual([])
    expect(errors).toHaveLength(1)

    expect(await drafts.newDraft({ server: "sidecar" as ServerConnection.Key, directory: "/project" })).toMatchObject({
      type: "draft",
      directory: "/project",
    })
    expect(configRequests).toBe(3)
    expect(created).toEqual(["/project"])
  })

  test("retains degraded and ready results for the child lifetime", async () => {
    let degradedCalls = 0
    const degraded = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        degradedCalls++
        return { status: "degraded" as const, errors: [new Error("provider failed")] }
      },
    })

    expect(await degraded.ensureReady("/project")).toBe("degraded")
    expect(await degraded.ensureReady("/project/")).toBe("degraded")
    expect(degraded.readiness("/project")).toBe("degraded")
    expect(degradedCalls).toBe(1)

    let readyCalls = 0
    const ready = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        readyCalls++
        return { status: "ready" as const, errors: [] }
      },
    })

    expect(await ready.ensureReady("/project")).toBe("ready")
    expect(await ready.ensureReady("/project")).toBe("ready")
    expect(readyCalls).toBe(1)

    ready.clear("/project/")
    expect(ready.readiness("/project")).toBe("initializing")
    expect(await ready.ensureReady("/project")).toBe("ready")
    expect(readyCalls).toBe(2)
  })

  test("invalidates every changed agent workspace and refreshes only active workspaces", async () => {
    const invalidated: string[] = []
    const refreshed: string[] = []
    const requests = refreshWorkspaceReadinessOnAgentChange({
      directories: ["C:\\active\\", "C:\\inactive\\"],
      active: (directory) => directory === "C:/active",
      invalidate: (directory) => invalidated.push(directory),
      refresh: async (directory) => {
        refreshed.push(directory)
        return "ready"
      },
    })

    expect(invalidated).toEqual(["C:/active", "C:/inactive"])
    expect(await Promise.all(requests)).toEqual(["ready"])
    expect(refreshed).toEqual(["C:/active"])
  })

  test("makes an invalidated ready workspace retry on the next readiness request", async () => {
    let calls = 0
    const controller = createWorkspaceReadinessController({
      scope: ServerScope.local,
      bootstrap: async () => {
        calls++
        return { status: "ready" as const, errors: [] }
      },
    })

    expect(await controller.ensureReady("/project")).toBe("ready")
    controller.invalidate("/project/")
    expect(controller.readiness("/project")).toBe("initializing")
    expect(await controller.ensureReady("/project")).toBe("ready")
    expect(calls).toBe(2)
  })
})

describe("MCP queries", () => {
  test("loads current servers for the requested location", async () => {
    const calls: unknown[] = []
    const queryClient = new QueryClient()
    const result = await queryClient.fetchQuery(
      loadMcpQuery(ServerScope.local, "/project", {
        list: async (input: McpListInput = {}) => {
          calls.push(input)
          return {
            location: { directory: "/project", project: { id: "project", directory: "/project" } },
            data: [
              { name: "docs", status: { status: "connected" } },
              { name: "search", status: { status: "pending" } },
            ],
          }
        },
      } as unknown as McpApi),
    )

    expect(calls).toEqual([{ location: { directory: "/project" } }])
    expect(result).toEqual({ docs: { status: "connected" }, search: { status: "pending" } })
  })

  test("loads and keys the current resource catalog", async () => {
    const calls: unknown[] = []
    const queryClient = new QueryClient()
    const result = await queryClient.fetchQuery(
      loadMcpResourcesQuery(ServerScope.local, "/project", {
        resource: {
          catalog: async (input: McpResourceCatalogInput = {}) => {
            calls.push(input)
            return {
              location: { directory: "/project", project: { id: "project", directory: "/project" } },
              data: {
                resources: [{ server: "docs", name: "Guide", uri: "docs://guide" }],
                templates: [],
              },
            }
          },
        },
      } as unknown as McpApi),
    )

    expect(calls).toEqual([{ location: { directory: "/project" } }])
    expect(result).toEqual({ "docs:docs://guide": { server: "docs", name: "Guide", uri: "docs://guide" } })
  })
})

describe("active session query", () => {
  test("loads active sessions immediately and once per server cache", async () => {
    let calls = 0
    const queryClient = new QueryClient()
    const options = loadActiveSessionsQuery(ServerScope.local, {
      active: async () => {
        calls++
        return { ses_running: { type: "running" } }
      },
    })

    expect(await queryClient.fetchQuery(options)).toEqual({ ses_running: { type: "running" } })
    expect(await queryClient.fetchQuery(options)).toEqual({ ses_running: { type: "running" } })
    expect(calls).toBe(1)
    expect(options.enabled).toBe(true)
    expect([...options.queryKey]).toEqual([ServerScope.local, "activeSessions"])
  })

  test("does not overwrite statuses already written by events", () => {
    const session = createServerSession({} as OpencodeClient)
    session.set("session_status", "ses_retry", { type: "retry", attempt: 2, message: "retrying", next: 10 })

    seedActiveSessionStatuses(session, {
      ses_running: { type: "running" },
      ses_retry: { type: "running" },
    })

    expect(session.data.session_status.ses_running).toEqual({ type: "busy" })
    expect(session.data.session_status.ses_retry).toEqual({
      type: "retry",
      attempt: 2,
      message: "retrying",
      next: 10,
    })
  })
})

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessions", () => {
  test("loads and normalizes a limited page of root sessions", async () => {
    const calls: SessionListInput[] = []

    const result = await loadRootSessions({
      api: {
        list: async (query = {}) => {
          calls.push(query)
          return { data: [sessionInfo("session-1")], cursor: {} }
        },
      } satisfies Pick<SessionApi, "list">,
      directory: "dir",
      limit: 10,
    })

    expect(result.data).toEqual([
      expect.objectContaining({ id: "session-1", directory: "dir", slug: "session-1", version: "" }),
    ])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", parentID: null, limit: 10, order: "desc" }])
  })

  test("propagates list failures", () => {
    expect(
      loadRootSessions({
        api: {
          list: async () => {
            throw new Error("failed")
          },
        } satisfies Pick<SessionApi, "list">,
        directory: "dir",
        limit: 25,
      }),
    ).rejects.toThrow("failed")
  })
})

function sessionInfo(id: string) {
  return {
    id,
    projectID: "project-1",
    agent: "build",
    model: { id: "model-1", providerID: "provider-1" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: id,
    location: { directory: "dir" },
  } as SessionInfo
}

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})

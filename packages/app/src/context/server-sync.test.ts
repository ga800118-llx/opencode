import { describe, expect, test } from "bun:test"
import type { Message, OpencodeClient, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
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
  type ActiveSessionStatuses,
  createWorkspaceReadinessController,
  createRuntimeRefreshController,
  dispatchServerEventRuntimeRefresh,
  loadAuthoritativeActiveSessionStatuses,
  loadActiveSessionsQuery,
  loadMcpQuery,
  loadMcpResourcesQuery,
  refetchProviderQueries,
  refreshWorkspaceReadinessOnAgentChange,
  refreshWorkspaceReadinessOnReconnect,
  reconcileActiveSessionStatuses,
  refreshActiveSessionsQuery,
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

describe("provider refresh", () => {
  test("keeps default refetch failures contained and lets strict callers reject", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let failing = false
    let requests = 0
    await queryClient.fetchQuery({
      queryKey: [ServerScope.local, null, "providers"],
      queryFn: async () => {
        requests++
        if (failing) throw new Error("provider refresh failed")
        return { all: new Map(), connected: [], default: {} }
      },
    })
    failing = true

    await expect(refetchProviderQueries(queryClient, ServerScope.local)).resolves.toBeUndefined()
    await expect(refetchProviderQueries(queryClient, ServerScope.local, { throwOnError: true })).rejects.toThrow(
      "provider refresh failed",
    )
    expect(requests).toBe(3)
  })
})

describe("active session query", () => {
  test("aggregates v1 statuses across loaded workspace clients", async () => {
    const requested: string[] = []
    const active = await loadAuthoritativeActiveSessionStatuses({
      protocol: "v1",
      directories: ["/repo-a", "/repo-b"],
      status: async (directory): Promise<Record<string, SessionStatus>> => {
        requested.push(directory)
        if (directory === "/repo-b") return { ses_b: { type: "busy" } }
        return {}
      },
      active: async () => {
        throw new Error("v2 active should not run")
      },
    })
    const session = createServerSession({} as OpencodeClient)
    session.set("session_status", "ses_a", { type: "busy" })
    session.set("session_status", "ses_b", { type: "busy" })

    reconcileActiveSessionStatuses(session, active ?? {})

    expect(requested).toEqual(["/repo-a", "/repo-b"])
    expect(session.data.session_status.ses_a).toEqual({ type: "idle" })
    expect(session.data.session_status.ses_b).toEqual({ type: "busy" })
  })

  test("does not manufacture an authoritative v1 snapshot without loaded workspaces", async () => {
    let requests = 0
    const active = await loadAuthoritativeActiveSessionStatuses({
      protocol: "v1",
      directories: [],
      status: async () => {
        requests++
        return {}
      },
      active: async () => ({}),
    })

    expect(active).toBeNull()
    expect(requests).toBe(0)
  })

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

  test("authoritatively overwrites active statuses and idles missing renderer work", () => {
    const session = createServerSession({} as OpencodeClient)
    session.set("session_status", "running", { type: "retry", attempt: 1, message: "stale", next: 5 })
    session.set("session_status", "retrying", { type: "busy" })
    session.set("session_status", "completed", { type: "busy" })
    session.set("session_status", "failed", { type: "retry", attempt: 2, message: "failed", next: 10 })
    session.set("session_status", "busy", { type: "idle" })
    session.set("session_status", "stopped", { type: "busy" })
    session.set("session_status", "idle", { type: "idle" })

    const result = reconcileActiveSessionStatuses(session, {
      running: { type: "running" },
      retrying: { type: "retry", attempt: 3, message: "retrying", next: 20 },
      busy: { type: "busy" },
      stopped: { type: "idle" },
    })

    expect(session.data.session_status.running).toEqual({ type: "busy" })
    expect(session.data.session_status.retrying).toEqual({
      type: "retry",
      attempt: 3,
      message: "retrying",
      next: 20,
    })
    expect(session.data.session_status.completed).toEqual({ type: "idle" })
    expect(session.data.session_status.failed).toEqual({ type: "idle" })
    expect(session.data.session_status.busy).toEqual({ type: "busy" })
    expect(session.data.session_status.stopped).toEqual({ type: "idle" })
    expect(session.data.session_status.idle).toEqual({ type: "idle" })
    expect(result).toEqual({ active: ["running", "retrying", "busy"], idle: ["stopped", "completed", "failed"] })
  })

  test("refetches cached active data on every settled runtime refresh", async () => {
    let calls = 0
    const refresh = deferred<Record<string, { type: "running" }>>()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = loadActiveSessionsQuery(ServerScope.local, {
      active: async () => {
        calls++
        if (calls === 1) return { initial: { type: "running" } }
        if (calls === 2) return refresh.promise
        return {}
      },
    })
    await queryClient.fetchQuery(options)
    const session = createServerSession({} as OpencodeClient)
    const controller = createRuntimeRefreshController({
      refreshConfig: async () => undefined,
      refreshProviders: async () => undefined,
      refreshActiveSessions: async () => {
        await queryClient.refetchQueries({ queryKey: options.queryKey, exact: true }, { throwOnError: true })
        return queryClient.getQueryData(options.queryKey) ?? {}
      },
      refreshAgents: async () => undefined,
      session,
    })

    const dispatch = (name: string, type: string) =>
      dispatchServerEventRuntimeRefresh(
        { name, details: { type } },
        { refreshRuntime: controller.refreshRuntime, reportError() {} },
      )

    await dispatch("/repo", "server.connected")
    await dispatch("global", "session.updated")
    expect(calls).toBe(1)

    const first = dispatch("global", "server.connected")
    const second = dispatch("global", "server.connected")
    await Promise.resolve()
    expect(calls).toBe(2)

    refresh.resolve({})
    await Promise.all([first, second])
    await dispatch("global", "server.connected")

    expect(calls).toBe(3)
  })

  test("coalesces concurrent refreshes and starts a new refresh after settlement", async () => {
    const active = deferred<Record<string, { type: "running" }>>()
    let calls = 0
    const controller = createRuntimeRefreshController({
      refreshConfig: async () => undefined,
      refreshProviders: async () => undefined,
      refreshActiveSessions: () => {
        calls++
        if (calls === 1) return active.promise
        return Promise.resolve({})
      },
      refreshAgents: async () => undefined,
      session: createServerSession({} as OpencodeClient),
    })

    const first = controller.refreshRuntime()
    const second = controller.refreshRuntime()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(calls).toBe(1)

    active.resolve({})
    await first
    await controller.refreshRuntime()
    expect(calls).toBe(2)
  })

  test("applies active reconciliation before slower runtime refreshes settle", async () => {
    const config = deferred<void>()
    const runtime = runtimeSession()
    runtime.session.set("session_status", "completed", { type: "busy" })
    const controller = createRuntimeRefreshController({
      refreshConfig: () => config.promise,
      refreshProviders: async () => undefined,
      refreshActiveSessions: async () => ({}),
      refreshAgents: async () => undefined,
      session: runtime.session,
    })

    const refresh = controller.refreshRuntime()
    await Bun.sleep(0)
    expect(runtime.session.data.session_status.completed).toEqual({ type: "idle" })

    config.resolve()
    await refresh
  })

  test("keeps a newer busy event over an older empty active snapshot", async () => {
    const active = deferred<ActiveSessionStatuses>()
    const runtime = runtimeSession()
    runtime.session.set("session_status", "changed", { type: "idle" })
    const controller = runtimeController(runtime.session, () => active.promise)

    const refresh = controller.refreshRuntime()
    await Promise.resolve()
    runtime.session.apply({
      type: "session.status",
      properties: { sessionID: "changed", status: { type: "busy" } },
    })
    active.resolve({})
    await refresh

    expect(runtime.session.data.session_status.changed).toEqual({ type: "busy" })
  })

  test("keeps a newer idle event over an older active snapshot", async () => {
    const active = deferred<ActiveSessionStatuses>()
    const runtime = runtimeSession()
    runtime.session.set("session_status", "changed", { type: "busy" })
    const controller = runtimeController(runtime.session, () => active.promise)

    const refresh = controller.refreshRuntime()
    await Promise.resolve()
    runtime.session.apply({
      type: "session.status",
      properties: { sessionID: "changed", status: { type: "idle" } },
    })
    active.resolve({ changed: { type: "running" } })
    await refresh

    expect(runtime.session.data.session_status.changed).toEqual({ type: "idle" })
  })

  test("reconciles completed, failed, and running work and refreshes loaded content", async () => {
    const runtime = runtimeSession()
    const failedMessage = runtimeErrorMessage("failed")
    runtime.session.set("session_status", "completed", { type: "busy" })
    runtime.session.set("session_status", "failed", { type: "retry", attempt: 2, message: "failed", next: 10 })
    runtime.session.set("session_status", "running", { type: "idle" })
    runtime.session.set("message", "completed", [])
    runtime.session.set("message", "failed", [failedMessage])
    runtime.session.set("message", "visible", [])
    runtime.session.pin("visible")
    const controller = runtimeController(runtime.session, async () => ({ running: { type: "running" } }))

    await controller.refreshRuntime()

    expect(runtime.session.data.session_status.completed).toEqual({ type: "idle" })
    expect(runtime.session.data.session_status.failed).toEqual({ type: "idle" })
    expect(runtime.session.data.session_status.running).toEqual({ type: "busy" })
    expect(runtime.resolved.toSorted()).toEqual(["completed", "failed", "running", "visible"])
    expect(runtime.synced.toSorted()).toEqual(["completed", "failed", "visible"])
  })

  test("force-syncs a pinned session without cached messages", async () => {
    const runtime = runtimeSession()
    runtime.session.pin("visible")
    const controller = runtimeController(runtime.session, async () => ({}))

    await controller.refreshRuntime()

    expect(runtime.resolved).toEqual(["visible"])
    expect(runtime.synced).toEqual(["visible"])
  })

  test("does not sync an invisible stale cached session", async () => {
    const runtime = runtimeSession(new Set(["cached"]))
    runtime.session.set("message", "cached", [runtimeErrorMessage("cached")])
    const controller = runtimeController(runtime.session, async () => ({}))

    await expect(controller.refreshRuntime()).resolves.toBeUndefined()
    expect(runtime.resolved).toEqual([])
    expect(runtime.synced).toEqual([])
  })

  test("starts a fresh active request when the initial query is still pending", async () => {
    const initial = deferred<ActiveSessionStatuses>()
    let calls = 0
    const load = () => {
      calls++
      if (calls === 1) return initial.promise
      return Promise.resolve({})
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = loadActiveSessionsQuery(ServerScope.local, { active: load })
    const initialRequest = queryClient.fetchQuery(options).catch(() => null)
    await Promise.resolve()
    const runtime = runtimeSession()
    runtime.session.set("session_status", "completed", { type: "busy" })
    const controller = runtimeController(runtime.session, () =>
      refreshActiveSessionsQuery(queryClient, options.queryKey, load),
    )

    await controller.refreshRuntime()
    expect(calls).toBe(2)
    expect(runtime.session.data.session_status.completed).toEqual({ type: "idle" })
    expect(queryClient.getQueryData<ActiveSessionStatuses | null>(options.queryKey)).toEqual({})

    initial.resolve({ completed: { type: "running" } })
    await initialRequest
    expect(queryClient.getQueryData<ActiveSessionStatuses | null>(options.queryKey)).toEqual({})
  })

  test("clears stale busy state when active refresh fails", async () => {
    const runtime = runtimeSession()
    runtime.session.set("session_status", "stale", { type: "busy" })
    const controller = runtimeController(runtime.session, async () => {
      throw new Error("active refresh failed")
    })

    await expect(controller.refreshRuntime()).rejects.toThrow("active refresh failed")
    expect(runtime.session.data.session_status.stale).toEqual({ type: "idle" })
  })

  test("preserves loaded error content without resolving when active refresh fails", async () => {
    const runtime = runtimeSession()
    const failedMessage = runtimeErrorMessage("failed")
    runtime.session.set("session_status", "failed", { type: "busy" })
    runtime.session.set("message", "failed", [failedMessage])
    const before = JSON.stringify(runtime.session.data.message.failed)
    const controller = runtimeController(runtime.session, async () => {
      throw new Error("active refresh failed")
    })

    await expect(controller.refreshRuntime()).rejects.toThrow("active refresh failed")
    expect(runtime.session.data.session_status.failed).toEqual({ type: "idle" })
    expect(runtime.resolved).toEqual([])
    expect(runtime.synced).toEqual([])
    expect(JSON.stringify(runtime.session.data.message.failed)).toBe(before)
    expect(runtime.session.data.message.failed).toEqual([failedMessage])
  })

  test("keeps existing error content when forced visible resolution fails", async () => {
    const runtime = runtimeSession(new Set(["failed"]))
    const failedMessage = runtimeErrorMessage("failed")
    runtime.session.set("session_status", "failed", { type: "busy" })
    runtime.session.set("message", "failed", [failedMessage])
    const controller = runtimeController(runtime.session, async () => ({}))

    await expect(controller.refreshRuntime()).rejects.toThrow("resolve failed")
    expect(runtime.session.data.session_status.failed).toEqual({ type: "idle" })
    expect(runtime.session.data.message.failed).toEqual([failedMessage])
  })

  test("reports background reconnect refresh failures", async () => {
    const errors: unknown[] = []

    await dispatchServerEventRuntimeRefresh(
      { name: "global", details: { type: "server.connected" } },
      {
        refreshRuntime: async () => {
          throw new Error("active refresh failed")
        },
        reportError: (error) => errors.push(error),
      },
    )

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toBe("active refresh failed")
  })
})

function runtimeController(
  session: ReturnType<typeof createServerSession>,
  refreshActiveSessions: () => Promise<ActiveSessionStatuses | null>,
) {
  return createRuntimeRefreshController({
    refreshConfig: async () => undefined,
    refreshProviders: async () => undefined,
    refreshActiveSessions,
    refreshAgents: async () => undefined,
    session,
  })
}

function runtimeSession(failMessages = new Set<string>()) {
  const resolved: string[] = []
  const synced: string[] = []
  const client = {
    session: {
      get: async (input: { sessionID: string }) => {
        resolved.push(input.sessionID)
        return { data: runtimeSessionInfo(input.sessionID) }
      },
      messages: async (input: { sessionID: string }) => {
        synced.push(input.sessionID)
        if (failMessages.has(input.sessionID)) throw new Error("resolve failed")
        return { data: [], response: { headers: new Headers() } }
      },
    },
  } as unknown as OpencodeClient
  return { resolved, session: createServerSession(client), synced }
}

function runtimeSessionInfo(id: string): Session {
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "/repo",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
  }
}

function runtimeErrorMessage(sessionID: string): Message {
  return {
    id: "error",
    sessionID,
    role: "assistant",
    time: { created: 1, completed: 2 },
    error: { name: "UnknownError", data: { message: "model failed" } },
    parentID: "user",
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

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

import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Config, OpencodeClient, Project } from "@opencode-ai/sdk/v2/client"
import type { AgentApi, CatalogApi, CommandApi, ReferenceApi } from "@opencode-ai/client/promise"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import {
  bootstrapDirectory,
  loadAgentsQuery,
  loadCommands,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
  WorkspaceBootstrapError,
} from "./bootstrap"
import type { State, VcsCache } from "./types"
import { ServerScope } from "@/utils/server-scope"
import { createApiForServer, type ServerApi } from "@/utils/server"
import { createCompatibleApi } from "@/utils/server-compat"

type ProjectApi = ServerApi["project"]

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse
const api = {
  agent: {
    list: async () => ({
      location: {},
      data: [
        {
          id: "build",
          mode: "primary",
          hidden: false,
          request: { headers: {}, body: {} },
          permissions: [],
        },
      ],
    }),
  },
  provider: { list: async () => ({ location: {}, data: [] }) },
  model: {
    list: async () => ({ location: {}, data: [] }),
    default: async () => ({ location: {}, data: null }),
  },
  permission: { request: { list: async () => ({ location: {}, data: [] }) } },
  project: {
    list: async () => [],
    current: async () => ({ id: "project", directory: "/project" }),
  },
  question: { request: { list: async () => ({ location: {}, data: [] }) } },
  reference: { list: async () => ({ location: {}, data: [] }) },
  vcs: { get: async () => ({ location: {}, data: {} }) },
} as unknown as ServerApi

function directoryState() {
  return createStore<State>({
    status: "loading",
    agent: [],
    command: [],
    reference: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider,
    config: {},
    path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_activity: {},
    session_working(id: string) {
      return this.session_status[id]?.type !== "idle"
    },
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    mcp_resource: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
  })
}

function v2Sdk(config: () => Promise<{ data: Config }> = async () => ({ data: {} })) {
  return {
    config: { get: config },
    lsp: { status: async () => ({ data: [] }) },
  } as unknown as OpencodeClient
}

function bootstrapInput(input: {
  sdk?: OpencodeClient
  api?: ServerApi
  mcp?: boolean
  project?: Project[]
  path?: { state: string; config: string; worktree: string; directory: string; home: string }
  loadSessions?: () => Promise<void> | void
  protocol?: Promise<"v1" | "v2">
}) {
  const [store, setStore] = directoryState()
  const result = bootstrapDirectory({
    directory: "/project",
    scope: ServerScope.local,
    mcp: input.mcp ?? false,
    global: {
      config: {},
      path: input.path ?? { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
      project: input.project ?? [{ id: "project", worktree: "/project" } as Project],
      provider,
    },
    sdk: input.sdk ?? v2Sdk(),
    api: input.api ?? api,
    store,
    setStore,
    vcsCache: { setStore() {} } as unknown as VcsCache,
    loadSessions: input.loadSessions ?? (() => {}),
    translate: (key) => key,
    queryClient: new QueryClient(),
    protocol: input.protocol,
  })
  return { result, store }
}

describe("bootstrapDirectory", () => {
  test("uses legacy MCP endpoints while refreshing a v1 directory", async () => {
    const mcpReads: string[] = []
    const [store, setStore] = directoryState()
    const legacy = {
      app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
      config: { get: async () => ({ data: {} }) },
      session: { status: async () => ({ data: {} }) },
      vcs: { get: async () => ({ data: undefined }) },
      command: {
        list: async () => {
          mcpReads.push("command")
          return { data: [] }
        },
      },
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => ({ data: [] }) },
      v2: { reference: { list: async () => ({ data: { data: [] } }) } },
      mcp: {
        status: async () => {
          mcpReads.push("status")
          return { data: {} }
        },
      },
      experimental: {
        resource: {
          list: async () => {
            mcpReads.push("resource")
            return { data: {} }
          },
        },
      },
      lsp: { status: async () => ({ data: [] }) },
      provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
    } as unknown as OpencodeClient
    const current = createApiForServer({
      server: { url: "http://localhost:4096" },
      fetch: Object.assign(() => Promise.resolve(Response.json({})), {
        preconnect: globalThis.fetch.preconnect,
      }),
    })
    const compatible = createCompatibleApi({
      protocol: Promise.resolve("v1"),
      current,
      legacy: () => legacy,
      directory: "/project",
    })

    const result = await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: true,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: legacy,
      api: compatible,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
      protocol: Promise.resolve("v1"),
    })

    expect(store.status).toBe("complete")
    expect(result).toEqual({ status: "ready", errors: [] })
    expect(mcpReads.sort()).toEqual(["command", "resource", "status"])
  })

  test("rejects when config initialization fails", async () => {
    const run = bootstrapInput({
      sdk: v2Sdk(async () => {
        throw new Error("config failed")
      }),
    })

    await expect(run.result).rejects.toBeInstanceOf(WorkspaceBootstrapError)
    await expect(run.result).rejects.toThrow("config failed")
    expect(run.store.status).toBe("partial")
  })

  test("rejects when project identity initialization fails", async () => {
    const run = bootstrapInput({
      project: [],
      api: {
        ...api,
        project: {
          ...api.project,
          current: async () => {
            throw new Error("project identity failed")
          },
        },
      } as unknown as ServerApi,
    })

    await expect(run.result).rejects.toThrow("project identity failed")
    expect(run.store.status).toBe("partial")
  })

  test("rejects when path initialization fails", async () => {
    const sdk = {
      app: { agents: async () => ({ data: [] }) },
      config: { get: async () => ({ data: {} }) },
      path: {
        get: async () => {
          throw new Error("path failed")
        },
      },
      session: { status: async () => ({ data: {} }) },
      vcs: { get: async () => ({ data: undefined }) },
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => ({ data: [] }) },
      v2: { reference: { list: async () => ({ data: { data: [] } }) } },
      provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
      lsp: { status: async () => ({ data: [] }) },
    } as unknown as OpencodeClient
    const run = bootstrapInput({
      sdk,
      path: { state: "", config: "", worktree: "", directory: "/other", home: "/home" },
      protocol: Promise.resolve("v1"),
    })

    await expect(run.result).rejects.toThrow("path failed")
    expect(run.store.status).toBe("partial")
  })

  test("returns degraded when provider and session history fail", async () => {
    const run = bootstrapInput({
      api: {
        ...api,
        provider: {
          list: async () => {
            throw new Error("provider failed")
          },
        },
      } as unknown as ServerApi,
      loadSessions: async () => {
        throw new Error("history failed")
      },
    })

    const result = await run.result
    expect(result.status).toBe("degraded")
    expect(result.errors.map((error) => error.message).sort()).toEqual(["history failed", "provider failed"])
    expect(run.store.status).toBe("complete")
  })

  test("loads commands, MCP status, and resources for a fresh child and degrades on optional failure", async () => {
    const calls: string[] = []
    const run = bootstrapInput({
      mcp: true,
      api: {
        ...api,
        command: {
          list: async () => {
            calls.push("command")
            return { location: {}, data: [] }
          },
        },
        mcp: {
          list: async () => {
            calls.push("status")
            throw new Error("mcp failed")
          },
          resource: {
            catalog: async () => {
              calls.push("resource")
              return { location: {}, data: { resources: [] } }
            },
          },
        },
      } as unknown as ServerApi,
    })

    const result = await run.result
    expect(new Set(calls)).toEqual(new Set(["command", "status", "resource"]))
    expect(result.status).toBe("degraded")
    expect(result.errors.map((error) => error.message)).toEqual(["mcp failed"])
    expect(run.store.status).toBe("complete")
  })
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const client = {} as Parameters<typeof loadPathQuery>[2]
    const api = {} as CatalogApi
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", client).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", client).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, api).queryKey]).toEqual(["https://debian.example", null, "providers"])
  })

  test("loads the current provider and model catalog", async () => {
    const calls: unknown[] = []
    const api = {
      provider: {
        list: async (input: unknown) => {
          calls.push(["provider", input])
          return { location: {}, data: [{ id: "openai", name: "OpenAI", package: "@ai-sdk/openai" }] }
        },
      },
      model: {
        list: async (input: unknown) => {
          calls.push(["model", input])
          return { location: {}, data: [] }
        },
        default: async () => {
          throw new Error("The current server protocol does not expose model.default")
        },
      },
    } as unknown as CatalogApi

    const result = await new QueryClient().fetchQuery(loadProvidersQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([
      ["provider", { location: { directory: "/repo" } }],
      ["model", { location: { directory: "/repo" } }],
    ])
    expect(result.connected).toEqual(["openai"])
  })

  test("loads agents from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {},
          data: [
            {
              id: "build",
              mode: "primary",
              hidden: false,
              request: { headers: {}, body: {} },
              permissions: [],
            },
          ],
        }
      },
    } as unknown as AgentApi

    const result = await new QueryClient().fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([expect.objectContaining({ name: "build", mode: "primary" })])
  })

  test("retries a transient empty agent registry before making the workspace ready", async () => {
    let calls = 0
    const api = {
      list: async () => ({
        location: {},
        data:
          ++calls === 1
            ? []
            : [
                {
                  id: "build",
                  mode: "primary",
                  hidden: false,
                  request: { headers: {}, body: {} },
                  permissions: [],
                },
              ],
      }),
    } as unknown as AgentApi

    const result = await new QueryClient().fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api))

    expect(calls).toBe(2)
    expect(result).toEqual([expect.objectContaining({ name: "build", mode: "primary" })])
  })

  test("stops after exactly six empty agent registry responses", async () => {
    let calls = 0
    const api = {
      list: async () => {
        calls++
        return { location: {}, data: [] }
      },
    } as unknown as AgentApi
    const options = loadAgentsQuery(ServerScope.local, "/repo", api)

    expect(options.retry).toBe(false)
    const interval = options.refetchInterval
    if (typeof interval !== "function") throw new Error("Agent recovery interval must be dynamic")
    expect(interval({ state: { status: "error" } } as Parameters<typeof interval>[0])).toBe(2_000)
    expect(interval({ state: { status: "success" } } as Parameters<typeof interval>[0])).toBe(false)
    await expect(new QueryClient().fetchQuery(options)).rejects.toThrow("No selectable agent is available")
    expect(calls).toBe(6)
  })

  test("loads commands from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {},
          data: [{ name: "review", template: "Review files" /* source: "command" as const */ }],
        }
      },
    } as unknown as CommandApi

    const result = await loadCommands("/repo", api)

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([{ name: "review", template: "Review files" /* source: "command" */ }])
  })

  test("loads projects from the current endpoint", async () => {
    const api = {
      list: async () => [
        { id: "b", worktree: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
        { id: "a", worktree: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
      ],
    } as unknown as ProjectApi

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api))

    expect(result.map((project) => project.id)).toEqual(["a", "b"])
  })

  test("loads references from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [{ name: "AGENTS.md", path: "/repo/AGENTS.md", source: "instructions" }] }
      },
    } as unknown as ReferenceApi

    const result = await new QueryClient().fetchQuery(loadReferencesQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toHaveLength(1)
  })
})

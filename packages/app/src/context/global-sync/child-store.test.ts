import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner, type Owner } from "solid-js"
import { createStore } from "solid-js/store"
import { renderToString } from "solid-js/web"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import type { State } from "./types"
import type { QueryOptionsApi } from "../server-sync"
import { ServerScope } from "@/utils/server-scope"
import { directoryKey } from "./utils"

let createChildStoreManager: typeof import("./child-store").createChildStoreManager
let actualPersisted: typeof import("@/utils/persist").persisted
let platform: { platform: "web" | "desktop"; storage?: () => DeferredStorage } = { platform: "web" }
const querySingles: Array<() => { queryKey?: unknown[]; enabled?: boolean }> = []
const persist: typeof import("@/utils/persist").persisted = (_target, store) => [
  store[0],
  store[1],
  null,
  Object.assign(() => true, { promise: undefined }),
  async () => {},
]

const child = () => createStore({} as State)
const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse

class DeferredStorage {
  private writes: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }> = []
  readonly calls = { set: 0 }

  async getItem(_key: string): Promise<string | null> {
    return null
  }

  setItem() {
    this.calls.set += 1
    return new Promise<void>((resolve, reject) => {
      this.writes.push({ resolve, reject })
    })
  }

  async removeItem() {}

  get pending() {
    return this.writes.length
  }

  resolveNext() {
    const write = this.writes.shift()
    if (!write) throw new Error("pending write required")
    write.resolve()
  }

  rejectNext(error: Error) {
    const write = this.writes.shift()
    if (!write) throw new Error("pending write required")
    write.reject(error)
  }
}

class HydrationStorage extends DeferredStorage {
  private readonly project = Promise.withResolvers<string | null>()

  getItem(key: string) {
    if (key === "workspace:project") return this.project.promise
    return Promise.resolve(null)
  }

  resolveProject(value: string | null) {
    this.project.resolve(value)
  }
}

async function waitForPending(storage: DeferredStorage) {
  for (const _ of Array.from({ length: 20 })) {
    if (storage.pending > 0) return
    await Promise.resolve()
  }
  throw new Error("pending write required")
}

const queryOptionsApi = {
  globalConfig: () => ({ queryKey: ["globalConfig"], queryFn: async () => ({}) }),
  projects: () => ({ queryKey: ["projects"], queryFn: async () => [] }),
  providers: (directory: string | null) => ({ queryKey: [directory, "providers"], queryFn: async () => provider }),
  path: (directory: string | null) => ({
    queryKey: [directory, "path"],
    queryFn: async () => ({
      state: "",
      config: "",
      worktree: "",
      directory: directory ?? "",
      home: "",
    }),
  }),
  agents: (directory: string) => ({ queryKey: [directory, "agents"], queryFn: async () => [] }),
  mcp: (directory: string) => ({ queryKey: [directory, "mcp"], queryFn: async () => ({}) }),
  mcpResources: (directory: string) => ({ queryKey: [directory, "mcpResources"], queryFn: async () => ({}) }),
  lsp: (directory: string) => ({ queryKey: [directory, "lsp"], queryFn: async () => [] }),
  references: (directory: string) => ({ queryKey: [directory, "references"], queryFn: async () => [] }),
  sessions: (directory: string) => ({ queryKey: [directory, "loadSessions"] as const }),
} as unknown as QueryOptionsApi

function createOwner(callback: (owner: Owner) => void) {
  return createRoot((dispose) => {
    const owner = getOwner()
    if (!owner) throw new Error("owner required")
    callback(owner)

    return dispose
  })
}

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => platform,
  }))
  mock.module("@tanstack/solid-query", () => ({
    useQuery: (options: () => { queryKey?: unknown[]; enabled?: boolean }) => {
      querySingles.push(options)
      return {
        get isLoading() {
          return options().queryKey?.[1] === "path"
        },
        get data() {
          if (options().queryKey?.[1] === "path") throw new Error("pending path data read")
          if (options().queryKey?.[1] === "mcp") return options().enabled ? { demo: { status: "disabled" } } : undefined
          if (options().queryKey?.[1] === "lsp") return []
          if (options().queryKey?.[1] === "providers") return provider
          return undefined
        },
      }
    },
  }))

  actualPersisted = (await import("@/utils/persist")).persisted
  createChildStoreManager = (await import("./child-store")).createChildStoreManager
})

beforeEach(() => {
  platform = { platform: "web" }
})

describe("createChildStoreManager", () => {
  test("does not evict the active directory during mark", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      scope: ServerScope.local,
      persist,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onMcp() {},
      onDispose() {},
      translate: (key) => key,
      queryOptions: queryOptionsApi,
      global: { provider },
    })

    Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
      manager.children[directory] = child()
      manager.pin(directory)
    })

    const directory = "/active"
    manager.children[directory] = child()
    manager.mark(directory)

    expect(manager.children[directory]).toBeDefined()
  })

  test("starts new child stores as loading and bootstraps them on first access", () => {
    const bootstraps: string[] = []
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap(directory) {
          bootstraps.push(directory)
        },
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")

      const [store] = manager.child("/project")

      expect(store.status).toBe("loading")
      expect(store.limit).toBe(5)
      expect(bootstraps).toEqual(["/project"])
    } finally {
      dispose()
    }
  })

  test("provides the requested directory while the path query is pending", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")

      const [store] = manager.child("/project", { bootstrap: false })

      expect(store.path.directory).toBe("/project")
      expect(store.path.worktree).toBe("")
    } finally {
      dispose()
    }
  })

  test("enables MCP only when requested for the directory", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const offset = querySingles.length
    const mcpLoads: string[] = []

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp(directory) {
          mcpLoads.push(directory)
        },
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store, setStore] = manager.child("/project", { bootstrap: false })
      expect(querySingles.length - offset).toBe(6)
      const query = querySingles[offset + 1]
      const resourceQuery = querySingles[offset + 2]
      if (!query) throw new Error("query required")
      if (!resourceQuery) throw new Error("resource query required")
      expect(query().enabled).toBe(false)
      expect(resourceQuery().enabled).toBe(false)

      setStore("status", "complete")
      manager.child("/project", { bootstrap: false, mcp: true })
      expect(query().enabled).toBe(true)
      expect(resourceQuery().enabled).toBe(true)
      expect(store.mcp).toEqual({ demo: { status: "disabled" } })
      expect(mcpLoads).toEqual(["/project"])

      manager.disableMcp("/project")
      expect(query().enabled).toBe(false)
      expect(manager.mcp("/project")).toBe(false)
    } finally {
      dispose()
    }
  })

  test("enables MCP for a fresh readiness child without starting another bootstrap", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const offset = querySingles.length
    const bootstraps: string[] = []
    const mcpLoads: string[] = []

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        isBooting: () => true,
        isLoadingSessions: () => false,
        onBootstrap(directory) {
          bootstraps.push(directory)
        },
        onMcp(directory) {
          mcpLoads.push(directory)
        },
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store, setStore] = manager.peek("/project", { bootstrap: false, mcp: true })
      const queries = querySingles.slice(offset)

      expect(store.status).toBe("loading")
      expect(queries[1]?.().enabled).toBe(true)
      expect(queries[2]?.().enabled).toBe(true)
      expect(manager.mcp("/project")).toBe(true)
      expect(bootstraps).toEqual([])
      expect(mcpLoads).toEqual([])

      setStore("status", "complete")
      manager.child("/project", { mcp: true })
      expect(bootstraps).toEqual([])
      expect(mcpLoads).toEqual([])
    } finally {
      dispose()
    }
  })

  test("keeps non-bootstrapping children passive until a real directory access", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const offset = querySingles.length
    const bootstraps: string[] = []

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap(directory) {
          bootstraps.push(directory)
        },
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      const queries = querySingles.slice(offset)

      expect(queries).toHaveLength(6)
      expect(queries[0]?.().enabled).toBe(false)
      expect(queries[3]?.().enabled).toBe(false)
      expect(queries[4]?.().enabled).toBe(false)
      expect(queries[5]?.().enabled).toBe(false)
      expect(store.path.directory).toBe("/project")
      expect(store.provider_ready).toBe(false)
      expect(store.lsp_ready).toBe(false)
      expect(bootstraps).toEqual([])

      manager.child("/project")
      expect(queries[0]?.().enabled).toBe(true)
      expect(queries[3]?.().enabled).toBe(true)
      expect(queries[4]?.().enabled).toBe(true)
      expect(queries[5]?.().enabled).toBe(true)
      expect(bootstraps).toEqual(["/project"])

      manager.child("/project", { bootstrap: false })
      expect(queries[0]?.().enabled).toBe(true)
    } finally {
      dispose()
    }
  })

  test("merges project metadata patches immediately and preserves explicit clears", async () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })

      await manager.projectMeta("/project", {
        name: "Project",
        icon: { color: "blue", override: "custom.png" },
        commands: { start: "bun dev" },
      })
      await manager.projectMeta("/project", {
        name: "",
        icon: { color: "" },
        commands: { start: "" },
      })

      expect(store.projectMeta).toEqual({
        name: "",
        icon: { color: "", override: "custom.png" },
        commands: { start: "" },
      })
    } finally {
      dispose()
    }
  })

  test("updates project metadata immediately while awaiting metadata and icon flushes", async () => {
    let resolveMeta: (() => void) | undefined
    let resolveIcon: (() => void) | undefined
    const deferredPersist: typeof import("@/utils/persist").persisted = (target, store) => {
      const key = typeof target === "string" ? target : target.key
      const flush = () => {
        if (key === "workspace:project") {
          return new Promise<void>((resolve) => {
            resolveMeta = resolve
          })
        }
        if (key === "workspace:icon") {
          return new Promise<void>((resolve) => {
            resolveIcon = resolve
          })
        }
        return Promise.resolve()
      }
      return [store[0], store[1], null, Object.assign(() => true, { promise: undefined }), flush]
    }
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist: deferredPersist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      let metaSettled = false
      const meta = manager.projectMeta("/project", { name: "Saved" }).then(() => {
        metaSettled = true
      })

      expect(store.projectMeta?.name).toBe("Saved")
      await Promise.resolve()
      expect(metaSettled).toBe(false)
      resolveMeta?.()
      await meta
      expect(metaSettled).toBe(true)

      let iconSettled = false
      const icon = manager.projectIcon("/project", "custom.png").then(() => {
        iconSettled = true
      })

      expect(store.icon).toBe("custom.png")
      await Promise.resolve()
      expect(iconSettled).toBe(false)
      resolveIcon?.()
      await icon
      expect(iconSettled).toBe(true)
    } finally {
      dispose()
    }
  })

  test("exposes authoritative project metadata hydration from desktop persistence", async () => {
    const storage = new HydrationStorage()
    platform = { platform: "desktop", storage: () => storage }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    let dispose = () => {}

    renderToString(() => {
      dispose = createOwner((owner) => {
        manager = createChildStoreManager({
          owner,
          scope: ServerScope.local,
          persist: actualPersisted,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {},
          onMcp() {},
          onDispose() {},
          translate: (key) => key,
          queryOptions: queryOptionsApi,
          global: { provider },
        })
      })
      return ""
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      let hydrated = false
      const ready = manager.child.ready("/project")?.then(() => {
        hydrated = true
      })

      await Promise.resolve()
      expect(hydrated).toBe(false)
      expect(store.projectMeta).toBeUndefined()

      storage.resolveProject(JSON.stringify({ value: { commands: { start: "bun run dev" } } }))
      await ready

      expect(hydrated).toBe(true)
      expect(store.projectMeta?.commands?.start).toBe("bun run dev")
    } finally {
      dispose()
    }
  })

  test("waits for project metadata hydration before merging a name-only save", async () => {
    const storage = new HydrationStorage()
    platform = { platform: "desktop", storage: () => storage }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    let dispose = () => {}

    renderToString(() => {
      dispose = createOwner((owner) => {
        manager = createChildStoreManager({
          owner,
          scope: ServerScope.local,
          persist: actualPersisted,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {},
          onMcp() {},
          onDispose() {},
          translate: (key) => key,
          queryOptions: queryOptionsApi,
          global: { provider },
        })
      })
      return ""
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      let settled = false
      const save = manager.projectMeta("/project", { name: "Renamed" }).then(() => {
        settled = true
      })

      await Promise.resolve()
      expect(settled).toBe(false)
      expect(store.projectMeta).toBeUndefined()

      storage.resolveProject(
        JSON.stringify({
          value: {
            icon: { color: "blue" },
            commands: { start: "bun run dev" },
          },
        }),
      )
      await waitForPending(storage)

      expect(store.projectMeta).toEqual({
        name: "Renamed",
        icon: { color: "blue" },
        commands: { start: "bun run dev" },
      })

      storage.resolveNext()
      await save
      expect(settled).toBe(true)
      expect(store.projectMeta).toEqual({
        name: "Renamed",
        icon: { color: "blue" },
        commands: { start: "bun run dev" },
      })
    } finally {
      dispose()
    }
  })

  test("writes and awaits the previous project metadata after the first flush fails", async () => {
    const storage = new DeferredStorage()
    platform = { platform: "desktop", storage: () => storage }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    let dispose = () => {}

    renderToString(() => {
      dispose = createOwner((owner) => {
        manager = createChildStoreManager({
          owner,
          scope: ServerScope.local,
          persist: actualPersisted,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {},
          onMcp() {},
          onDispose() {},
          translate: (key) => key,
          queryOptions: queryOptionsApi,
          global: { provider },
        })
      })
      return ""
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      const save = manager.projectMeta("/project", { name: "Unsaved" })

      await waitForPending(storage)
      expect(store.projectMeta).toEqual({ name: "Unsaved", icon: undefined, commands: undefined })
      storage.rejectNext(new Error("disk full"))
      await waitForPending(storage)

      let settled = false
      void save.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await Promise.resolve()
      expect(storage.calls.set).toBe(2)
      expect(settled).toBe(false)
      expect(manager.disposeDirectory(directoryKey("/project"))).toBe(false)

      storage.resolveNext()
      await expect(save).rejects.toThrow("disk full")
      expect(store.projectMeta).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("reports both errors and protects the store until a failed metadata rollback settles", async () => {
    const storage = new DeferredStorage()
    platform = { platform: "desktop", storage: () => storage }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    let dispose = () => {}

    renderToString(() => {
      dispose = createOwner((owner) => {
        manager = createChildStoreManager({
          owner,
          scope: ServerScope.local,
          persist: actualPersisted,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {},
          onMcp() {},
          onDispose() {},
          translate: (key) => key,
          queryOptions: queryOptionsApi,
          global: { provider },
        })
      })
      return ""
    })

    try {
      if (!manager) throw new Error("manager required")
      const save = manager.projectMeta("/project", { name: "Unsaved" })

      await waitForPending(storage)
      storage.rejectNext(new Error("primary write failed"))
      await waitForPending(storage)
      expect(manager.disposeDirectory(directoryKey("/project"))).toBe(false)

      storage.rejectNext(new Error("rollback write failed"))
      const error = await save.catch((error) => error)

      expect(error).toBeInstanceOf(AggregateError)
      if (!(error instanceof AggregateError)) throw new Error("aggregate error required")
      expect(error.message).toContain("restore")
      expect(error.errors).toEqual([
        expect.objectContaining({ message: "primary write failed" }),
        expect.objectContaining({ message: "rollback write failed" }),
      ])
      expect(error.cause).toEqual(expect.objectContaining({ message: "primary write failed" }))
      expect(manager.disposeDirectory(directoryKey("/project"))).toBe(true)
    } finally {
      dispose()
    }
  })

  test("keeps a later successful metadata write after an earlier flush fails", async () => {
    const first = Promise.withResolvers<void>()
    let writes = 0
    const deferredPersist: typeof import("@/utils/persist").persisted = (target, store) => {
      const key = typeof target === "string" ? target : target.key
      const flush = () => {
        if (key !== "workspace:project") return Promise.resolve()
        writes += 1
        if (writes === 1) return first.promise
        return Promise.resolve()
      }
      return [store[0], store[1], null, Object.assign(() => true, { promise: undefined }), flush]
    }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist: deferredPersist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      const saveFirst = manager.projectMeta("/project", { name: "First" })
      const saveSecond = manager.projectMeta("/project", { name: "Second" })
      first.reject(new Error("first failed"))
      await expect(saveFirst).rejects.toThrow("first failed")
      await saveSecond
      expect(store.projectMeta?.name).toBe("Second")
    } finally {
      dispose()
    }
  })

  test("does not evict a directory while project metadata is being persisted", async () => {
    const pending = Promise.withResolvers<void>()
    const deferredPersist: typeof import("@/utils/persist").persisted = (target, store) => {
      const key = typeof target === "string" ? target : target.key
      return [
        store[0],
        store[1],
        null,
        Object.assign(() => true, { promise: undefined }),
        () => (key === "workspace:project" ? pending.promise : Promise.resolve()),
      ]
    }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist: deferredPersist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const save = manager.projectMeta("/project", { name: "Saved" })

      expect(manager.disposeDirectory(directoryKey("/project"))).toBe(false)
      expect(manager.children["/project"]).toBeDefined()

      pending.resolve()
      await save
      expect(manager.disposeDirectory(directoryKey("/project"))).toBe(true)
    } finally {
      dispose()
    }
  })

  test("retries the same project icon through real deferred persistence after a failed flush", async () => {
    const storage = new DeferredStorage()
    platform = { platform: "desktop", storage: () => storage }
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    let dispose = () => {}

    renderToString(() => {
      dispose = createOwner((owner) => {
        manager = createChildStoreManager({
          owner,
          scope: ServerScope.local,
          persist: actualPersisted,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {},
          onMcp() {},
          onDispose() {},
          translate: (key) => key,
          queryOptions: queryOptionsApi,
          global: { provider },
        })
      })
      return ""
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      const first = manager.projectIcon("/project", "custom.png").then(
        () => undefined,
        (error) => error,
      )

      expect(store.icon).toBe("custom.png")
      await waitForPending(storage)
      expect(storage.calls.set).toBe(1)
      storage.rejectNext(new Error("icon write failed"))
      const error = await first
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("icon write failed")

      const second = manager.projectIcon("/project", "custom.png")
      await waitForPending(storage)
      expect(storage.calls.set).toBe(2)
      storage.resolveNext()
      await second
      expect(store.icon).toBe("custom.png")
    } finally {
      dispose()
    }
  })
})

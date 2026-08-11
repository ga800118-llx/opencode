import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { ServerScope } from "./server-scope"
import { createStore } from "solid-js/store"
import { renderToString } from "solid-js/web"
import type { AsyncStorage } from "@solid-primitives/storage"

type PersistTestingType = typeof import("./persist").PersistTesting
type PersistType = typeof import("./persist").Persist
type RemovePersistedType = typeof import("./persist").removePersisted
type PersistedType = typeof import("./persist").persisted

type TestPlatform = {
  platform: "web" | "desktop"
  storage?: (name?: string) => AsyncStorage
}

class DeferredStorage {
  private writes: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }> = []

  async getItem() {
    return null
  }

  setItem() {
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

async function waitForPending(storage: DeferredStorage) {
  for (const _ of Array.from({ length: 20 })) {
    if (storage.pending > 0) return
    await Promise.resolve()
  }
  throw new Error("pending write required")
}

class MigrationStorage {
  private values = new Map<string, string>()
  private deferred = new Set<string>()
  private reads = new Map<string, (value: string | null) => void>()
  readonly events: string[]

  constructor(events: string[]) {
    this.events = events
  }

  defer(key: string) {
    this.deferred.add(key)
  }

  release(key: string, value: string | null) {
    const read = this.reads.get(key)
    if (!read) throw new Error(`deferred read required for ${key}`)
    this.reads.delete(key)
    this.deferred.delete(key)
    if (value === null) this.values.delete(key)
    else this.values.set(key, value)
    read(value)
  }

  getItem(key: string) {
    this.events.push(`get:${key}`)
    if (!this.deferred.has(key)) return Promise.resolve(this.values.get(key) ?? null)
    return new Promise<string | null>((resolve) => this.reads.set(key, resolve))
  }

  async setItem(key: string, value: string) {
    this.events.push(`set:${key}:${value}`)
    this.values.set(key, value)
  }

  async removeItem(key: string) {
    this.events.push(`remove:${key}`)
    this.values.delete(key)
  }

  value(key: string) {
    return this.values.get(key)
  }

  waiting(key: string) {
    return this.reads.has(key)
  }
}

async function waitForRead(storage: MigrationStorage, key: string) {
  for (const _ of Array.from({ length: 20 })) {
    if (storage.waiting(key)) return
    await Promise.resolve()
  }
  throw new Error(`deferred read required for ${key}`)
}

class RejectingStorage {
  calls = 0

  async getItem() {
    return null
  }

  setItem() {
    this.calls += 1
    return Promise.reject(new Error(`write failed ${this.calls}`))
  }

  async removeItem() {}
}

class SyncThrowStorage {
  private fail = true
  value: string | undefined

  async getItem() {
    return null
  }

  setItem(_key: string, value: string) {
    if (this.fail) {
      this.fail = false
      throw new Error("synchronous write failed")
    }
    this.value = value
    return Promise.resolve()
  }

  async removeItem() {}
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  readonly events: string[] = []
  readonly calls = { get: 0, set: 0, remove: 0 }

  clear() {
    this.values.clear()
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  getItem(key: string) {
    this.calls.get += 1
    this.events.push(`get:${key}`)
    if (key.startsWith("opencode.throw")) throw new Error("storage get failed")
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.calls.set += 1
    this.events.push(`set:${key}`)
    if (key.startsWith("opencode.quota")) throw new DOMException("quota", "QuotaExceededError")
    if (key.startsWith("opencode.throw")) throw new Error("storage set failed")
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.calls.remove += 1
    this.events.push(`remove:${key}`)
    if (key.startsWith("opencode.throw")) throw new Error("storage remove failed")
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

let persistTesting: PersistTestingType
let Persist: PersistType
let removePersisted: RemovePersistedType
let persisted: PersistedType
let platform: TestPlatform = { platform: "web" }

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => platform,
  }))

  const mod = await import("./persist")
  persistTesting = mod.PersistTesting
  Persist = mod.Persist
  removePersisted = mod.removePersisted
  persisted = mod.persisted
})

beforeEach(() => {
  platform = { platform: "web" }
  storage.clear()
  storage.events.length = 0
  storage.calls.get = 0
  storage.calls.set = 0
  storage.calls.remove = 0
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

function createTestPersisted(key: string) {
  return persisted(key, createStore({ value: 0 }))
}

describe("persist flush", () => {
  test("waits for the current desktop write", async () => {
    const storage = new DeferredStorage()
    platform = { platform: "desktop", storage: () => storage }
    let result: ReturnType<typeof createTestPersisted> | undefined
    renderToString(() => {
      result = createTestPersisted("flush.wait")
      return ""
    })
    if (!result) throw new Error("persisted store required")

    const [, setStore, , , flush] = result
    setStore("value", 1)

    let settled = false
    const flushed = flush().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    await waitForPending(storage)
    storage.resolveNext()
    await flushed
    expect(settled).toBe(true)
  })

  test("rejects failed writes and recovers on the next write", async () => {
    const storage = new DeferredStorage()
    platform = { platform: "desktop", storage: () => storage }
    let result: ReturnType<typeof createTestPersisted> | undefined
    renderToString(() => {
      result = createTestPersisted("flush.recover")
      return ""
    })
    if (!result) throw new Error("persisted store required")

    const [, setStore, , , flush] = result
    setStore("value", 1)

    const failed = flush().then(
      () => undefined,
      (error) => error,
    )
    await waitForPending(storage)
    storage.rejectNext(new Error("desktop write failed"))
    const error = await failed
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("desktop write failed")

    setStore("value", 2)
    const recovered = flush()
    await waitForPending(storage)
    storage.resolveNext()
    await recovered
  })

  test("orders delayed legacy migration before a user write and flushes the final value", async () => {
    const events: string[] = []
    const target = Persist.workspace("/project", "project", ["project.v1"])
    const current = new MigrationStorage(events)
    const legacy = new MigrationStorage(events)
    legacy.defer("project.v1")
    platform = {
      platform: "desktop",
      storage: (name) => (name === target.storage ? current : legacy),
    }
    let result: ReturnType<typeof persisted<{ value: { name?: string } | undefined }>> | undefined
    renderToString(() => {
      result = persisted(target, createStore({ value: undefined as { name?: string } | undefined }))
      return ""
    })
    if (!result) throw new Error("persisted store required")

    const [store, setStore, , , flush] = result
    setStore("value", { name: "new" })
    let settled = false
    const saving = flush().then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    await waitForRead(legacy, "project.v1")
    legacy.release("project.v1", '{"value":{"name":"old"}}')
    await saving

    expect(store.value).toEqual({ name: "new" })
    expect(current.value(target.key)).toBe('{"value":{"name":"new"}}')
    expect(events.filter((event) => event.startsWith(`set:${target.key}:`))).toEqual([
      `set:${target.key}:{"value":{"name":"old"}}`,
      `set:${target.key}:{"value":{"name":"new"}}`,
    ])
  })

  test("retains only the latest unflushed asynchronous failure and consumes it", async () => {
    const storage = new RejectingStorage()
    platform = { platform: "desktop", storage: () => storage }
    let result: ReturnType<typeof createTestPersisted> | undefined
    renderToString(() => {
      result = createTestPersisted("flush.bounded")
      return ""
    })
    if (!result) throw new Error("persisted store required")

    const [, setStore, init, , flush] = result
    if (init instanceof Promise) await init
    for (const value of Array.from({ length: 40 }, (_, index) => index + 1)) setStore("value", value)
    await Promise.resolve()
    await Promise.resolve()

    await expect(flush()).rejects.toThrow("write failed 40")
    await expect(flush()).resolves.toBeUndefined()
  })

  test("does not retain a synchronous failure after a successful retry", async () => {
    const storage = new SyncThrowStorage()
    platform = { platform: "desktop", storage: () => storage }
    let result: ReturnType<typeof createTestPersisted> | undefined
    renderToString(() => {
      result = createTestPersisted("flush.sync-recover")
      return ""
    })
    if (!result) throw new Error("persisted store required")

    const [, setStore, init, , flush] = result
    if (init instanceof Promise) await init
    await Promise.resolve()
    expect(() => setStore("value", 1)).toThrow("synchronous write failed")

    setStore("value", 2)
    await expect(flush()).resolves.toBeUndefined()
    expect(storage.value).toBe('{"value":2}')
  })
})

describe("persist localStorage resilience", () => {
  test("does not cache values as persisted when quota write and eviction fail", () => {
    const storageApi = persistTesting.localStorageWithPrefix("opencode.quota.scope")
    storageApi.setItem("value", '{"value":1}')

    expect(storage.getItem("opencode.quota.scope:value")).toBeNull()
    expect(storageApi.getItem("value")).toBeNull()
  })

  test("disables only the failing scope when storage throws", () => {
    const bad = persistTesting.localStorageWithPrefix("opencode.throw.scope")
    bad.setItem("value", '{"value":1}')

    const before = storage.calls.set
    bad.setItem("value", '{"value":2}')
    expect(storage.calls.set).toBe(before)
    expect(bad.getItem("value")).toBeNull()

    const healthy = persistTesting.localStorageWithPrefix("opencode.safe.scope")
    healthy.setItem("value", '{"value":3}')
    expect(storage.getItem("opencode.safe.scope:value")).toBe('{"value":3}')
  })

  test("failing fallback scope does not poison direct storage scope", () => {
    const broken = persistTesting.localStorageWithPrefix("opencode.throw.scope2")
    broken.setItem("value", '{"value":1}')

    const direct = persistTesting.localStorageDirect()
    direct.setItem("direct-value", '{"value":5}')

    expect(storage.getItem("direct-value")).toBe('{"value":5}')
  })

  test("normalizer rejects malformed JSON payloads", () => {
    const result = persistTesting.normalize({ value: "ok" }, '{"value":"\\x"}')
    expect(result).toBeUndefined()
  })

  test("workspace storage sanitizes Windows filename characters", () => {
    const result = persistTesting.workspaceStorage("C:\\Users\\foo")

    expect(result).toStartWith("opencode.workspace.")
    expect(result.endsWith(".dat")).toBeTrue()
    expect(/[:\\/]/.test(result)).toBeFalse()
  })

  test("workspace target keeps raw path storage as legacy fallback", () => {
    const target = Persist.workspace("C:\\Users\\foo", "vcs")

    expect(target.storage).toBe(persistTesting.workspaceStorage("C:/Users/foo"))
    expect(target.legacyStorageNames).toEqual([persistTesting.workspaceStorage("C:\\Users\\foo")])
  })

  test("workspace target keeps backslash storage as fallback for normalized Windows paths", () => {
    const target = Persist.workspace("C:/Users/foo", "vcs")

    expect(target.storage).toBe(persistTesting.workspaceStorage("C:/Users/foo"))
    expect(target.legacyStorageNames).toEqual([persistTesting.workspaceStorage("C:\\Users\\foo")])
  })

  test("migrates direct legacy keys into scoped storage", () => {
    storage.setItem("legacy.workspace", '{"value":2}')
    const target = Persist.workspace("C:/Users/foo", "demo", ["legacy.workspace"])
    const current = persistTesting.localStorageWithPrefix(target.storage!)
    const legacyStore = persistTesting.localStorageDirect()

    const result = persistTesting.migrateLegacy({
      current,
      legacyStore,
      stores: [],
      keys: target.legacy!,
      key: target.key,
      defaults: { value: 1 },
    })

    expect(result).toBe('{"value":2}')
    expect(storage.getItem(`${target.storage}:${target.key}`)).toBe('{"value":2}')
    expect(legacyStore.getItem("legacy.workspace")).toBeNull()
    expect(storage.getItem("legacy.workspace")).toBeNull()
  })

  test("removes legacy workspace storage when removing persisted target", () => {
    const target = Persist.workspace("C:\\Users\\foo", "terminal")
    storage.setItem(`${target.storage}:${target.key}`, '{"value":1}')
    storage.setItem(`${target.legacyStorageNames![0]}:${target.key}`, '{"value":2}')

    removePersisted(target)

    expect(storage.getItem(`${target.storage}:${target.key}`)).toBeNull()
    expect(storage.getItem(`${target.legacyStorageNames![0]}:${target.key}`)).toBeNull()
  })

  test("draft target isolates storage per draft and namespaces keys", () => {
    const a = Persist.draft("draft-a", "prompt")
    const b = Persist.draft("draft-b", "prompt")

    expect(a.key).toBe("draft:prompt")
    expect(a.storage).not.toBe(b.storage)
    expect(a.storage).not.toBe(Persist.workspace("/home/luke/repo", "prompt").storage)
  })

  test("removes draft storage when removing persisted target", () => {
    const target = Persist.draft("draft-a", "prompt")
    storage.setItem(`${target.storage}:${target.key}`, '{"value":1}')

    removePersisted(target)

    expect(storage.getItem(`${target.storage}:${target.key}`)).toBeNull()
  })

  test("server workspace target preserves local storage and isolates remote storage", () => {
    const local = Persist.serverWorkspace(ServerScope.local, "/home/luke/repo", "prompt")
    const windows = Persist.serverWorkspace("https://windows.example" as ServerScope, "/home/luke/repo", "prompt")
    const debian = Persist.serverWorkspace("https://debian.example" as ServerScope, "/home/luke/repo", "prompt")

    expect(local).toEqual(Persist.workspace("/home/luke/repo", "prompt"))
    expect(windows.storage).not.toBe(local.storage)
    expect(debian.storage).not.toBe(local.storage)
    expect(debian.storage).not.toBe(windows.storage)
    expect(windows.legacyStorageNames).toBeUndefined()
    expect(debian.legacyStorageNames).toBeUndefined()
  })

  test("server global target preserves local key and isolates remote keys", () => {
    expect(Persist.serverGlobal(ServerScope.local, "notification")).toEqual(Persist.global("notification"))
    expect(Persist.serverGlobal("https://debian.example" as ServerScope, "notification")).toEqual({
      storage: "opencode.global.dat",
      key: "https://debian.example\0notification",
    })
  })

  test("server global target cannot collide when scope and key contain colons", () => {
    expect(Persist.serverGlobal("a:b" as ServerScope, "c")).not.toEqual(Persist.serverGlobal("a" as ServerScope, "b:c"))
  })
})

import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./tab-memory"
import { nextTabAfterClose, pushClosedTab, removeClosedTabs, takeClosedTab, type ClosedTab } from "./closed-tabs"
import { createSessionTabReconciler, probeSessionTab, type SessionTabProbeResult } from "./session-tab-reconciliation"
import {
  collectSessionTabCandidates,
  createDraftReadinessController,
  type DraftTab,
  type SessionTab,
  type Tab,
} from "./tabs"
import { migrateTabs } from "./tab-migration"
import type { ServerConnection } from "./server"
import { createWorkspaceReadinessController } from "./server-sync"
import { sessionNotFoundError } from "@/utils/server-errors"
import { ServerScope } from "@/utils/server-scope"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key
const remoteServer = "remote\nhttps://windows.example" as ServerConnection.Key

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function sessionTab(sessionId: string): SessionTab {
  return { type: "session", server, sessionId }
}

describe("session tab reconciliation", () => {
  test("collects open and closed sessions only for ready servers", () => {
    const duplicate = sessionTab("duplicate")

    expect(
      collectSessionTabCandidates(
        [
          sessionTab("open"),
          duplicate,
          { type: "draft", draftID: "draft", server, directory: "/project" },
          { ...sessionTab("remote-open"), server: remoteServer },
        ],
        [
          { tab: duplicate, index: 0 },
          { tab: sessionTab("closed"), index: 1 },
          { tab: { ...sessionTab("remote-closed"), server: remoteServer }, index: 2 },
        ],
        new Set([server]),
      ),
    ).toEqual([sessionTab("open"), duplicate, duplicate, sessionTab("closed")])
  })

  test("classifies session resolution results", async () => {
    const typed = new Error("missing", {
      cause: { body: { _tag: "SessionNotFoundError", sessionID: "gone", message: "missing" }, status: 404 },
    })

    expect(await probeSessionTab("gone", async () => Promise.reject(typed))).toBe("missing")
    expect(await probeSessionTab("gone", async () => Promise.reject(sessionNotFoundError("gone")))).toBe("missing")
    expect(await probeSessionTab("other", async () => Promise.reject(typed))).toBe("unavailable")
    expect(await probeSessionTab("gone", async () => Promise.reject(new Error("offline")))).toBe("unavailable")
    expect(await probeSessionTab("live", async () => ({ id: "live" }))).toBe("present")
  })

  test("deduplicates references and groups missing sessions by server", async () => {
    const probes: SessionTab[] = []
    const removed: Array<{ server: ServerConnection.Key; sessionIDs: string[] }> = []
    const remoteMissing = { ...sessionTab("missing-a"), server: remoteServer }
    const tabs = [
      sessionTab("present"),
      sessionTab("missing-a"),
      sessionTab("missing-a"),
      sessionTab("missing-b"),
      remoteMissing,
    ]
    const reconciler = createSessionTabReconciler({
      probe: async (tab) => {
        probes.push(tab)
        return tab.sessionId.startsWith("missing") ? "missing" : "present"
      },
      remove: (target, sessionIDs) => {
        removed.push({ server: target, sessionIDs })
      },
    })

    await reconciler.reconcile(tabs)
    await reconciler.reconcile(tabs)

    expect(probes).toEqual([sessionTab("present"), sessionTab("missing-a"), sessionTab("missing-b"), remoteMissing])
    expect(removed).toEqual([
      { server, sessionIDs: ["missing-a", "missing-b"] },
      { server: remoteServer, sessionIDs: ["missing-a"] },
    ])
  })

  test("retries failed removals without probing settled missing sessions", async () => {
    let probes = 0
    let removals = 0
    const reconciler = createSessionTabReconciler({
      probe: async () => {
        probes++
        return "missing"
      },
      remove: () => {
        removals++
        if (removals === 1) throw new Error("remove failed")
      },
    })

    await reconciler.reconcile([sessionTab("missing")])
    await reconciler.reconcile([sessionTab("missing")])

    expect(probes).toBe(1)
    expect(removals).toBe(2)
  })

  test("queues overlapping reconciliation behind a failed removal", async () => {
    const failed = deferred<void>()
    const started = deferred<void>()
    let probes = 0
    let removals = 0
    const reconciler = createSessionTabReconciler({
      probe: async () => {
        probes++
        return "missing"
      },
      remove: () => {
        removals++
        if (removals !== 1) return
        started.resolve(undefined)
        return failed.promise
      },
    })

    const first = reconciler.reconcile([sessionTab("missing")])
    await started.promise
    const second = reconciler.reconcile([sessionTab("missing")])
    await new Promise((resolve) => setTimeout(resolve, 0))
    failed.reject(new Error("remove failed"))
    await Promise.all([first, second])

    expect(probes).toBe(1)
    expect(removals).toBe(2)
  })

  test("coalesces overlapping reconciliation into the latest queued snapshot", async () => {
    const blocked = deferred<SessionTabProbeResult>()
    const started = deferred<void>()
    const probes: string[] = []
    const removed: string[] = []
    const reconciler = createSessionTabReconciler({
      probe: (tab) => {
        probes.push(tab.sessionId)
        if (tab.sessionId !== "active") return Promise.resolve("missing")
        started.resolve(undefined)
        return blocked.promise
      },
      remove: (_, sessionIDs) => {
        removed.push(...sessionIDs)
      },
    })

    const active = reconciler.reconcile([sessionTab("active")])
    await started.promise
    const old = reconciler.reconcile([sessionTab("old")])
    const latest = reconciler.reconcile([sessionTab("latest")])
    const shared = old === latest
    blocked.resolve("present")
    await Promise.all([active, old, latest])

    expect(shared).toBe(true)
    expect(probes).toEqual(["active", "latest"])
    expect(removed).toEqual(["latest"])
  })

  test("releases settled and removed entries outside the current candidates", async () => {
    const probes: string[] = []
    const removed: string[] = []
    const reconciler = createSessionTabReconciler({
      probe: async (tab) => {
        probes.push(tab.sessionId)
        return "missing"
      },
      remove: (_, sessionIDs) => {
        removed.push(...sessionIDs)
      },
    })

    await reconciler.reconcile([sessionTab("a")])
    await reconciler.reconcile([sessionTab("b")])
    await reconciler.reconcile([sessionTab("a")])

    expect(probes).toEqual(["a", "b", "a"])
    expect(removed).toEqual(["a", "b", "a"])
  })

  test("shares pending probes across concurrent reconciliation", async () => {
    const result = deferred<SessionTabProbeResult>()
    let probes = 0
    let removals = 0
    const reconciler = createSessionTabReconciler({
      probe: () => {
        probes++
        return result.promise
      },
      remove: () => {
        removals++
      },
    })

    const first = reconciler.reconcile([sessionTab("shared"), sessionTab("shared")])
    const second = reconciler.reconcile([sessionTab("shared")])
    await Promise.resolve()

    expect(probes).toBe(1)
    result.resolve("missing")
    await Promise.all([first, second])
    expect(removals).toBe(1)
  })

  test("retries unavailable and thrown probes without repeating settled probes", async () => {
    const attempts = new Map<string, number>()
    const removed: string[][] = []
    const reconciler = createSessionTabReconciler({
      maxUnavailableAttempts: 2,
      probe: async (tab) => {
        const count = (attempts.get(tab.sessionId) ?? 0) + 1
        attempts.set(tab.sessionId, count)
        if (tab.sessionId === "retry") return "unavailable"
        if (tab.sessionId === "throw" && count === 1) throw new Error("probe failed")
        if (tab.sessionId === "missing") return "missing"
        return "present"
      },
      remove: (_, sessionIDs) => {
        removed.push(sessionIDs)
      },
    })
    const tabs = [sessionTab("present"), sessionTab("missing"), sessionTab("retry"), sessionTab("throw")]

    await reconciler.reconcile(tabs)
    await reconciler.reconcile(tabs)

    expect(attempts).toEqual(
      new Map([
        ["present", 1],
        ["missing", 1],
        ["retry", 2],
        ["throw", 2],
      ]),
    )
    expect(removed).toEqual([["missing"]])
  })

  test("starts a new bounded retry cycle after the cooldown", async () => {
    const removed = deferred<void>()
    let attempts = 0
    const reconciler = createSessionTabReconciler({
      maxUnavailableAttempts: 2,
      retryCycleDelayMs: 1,
      retryDelayMs: 1,
      probe: async () => {
        attempts++
        return attempts <= 2 ? "unavailable" : "missing"
      },
      remove: () => removed.resolve(undefined),
    })

    await reconciler.reconcile([sessionTab("retry")])
    await removed.promise

    expect(attempts).toBe(3)
    reconciler.dispose()
  })

  test("limits probe concurrency and continues after stalled probes time out", async () => {
    let active = 0
    let peak = 0
    const removed: string[][] = []
    const reconciler = createSessionTabReconciler({
      concurrency: 2,
      maxUnavailableAttempts: 1,
      timeoutMs: 5,
      probe: (tab, signal) => {
        active++
        peak = Math.max(peak, active)
        if (!tab.sessionId.startsWith("stalled")) {
          active--
          return Promise.resolve("missing")
        }
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              active--
              resolve("unavailable")
            },
            { once: true },
          )
        })
      },
      remove: (_, sessionIDs) => {
        removed.push(sessionIDs)
      },
    })

    await reconciler.reconcile([
      sessionTab("stalled-a"),
      sessionTab("missing-a"),
      sessionTab("stalled-b"),
      sessionTab("missing-b"),
    ])

    expect(peak).toBe(2)
    expect(removed).toEqual([["missing-a", "missing-b"]])
    reconciler.dispose()
  })

  test("aborts pending probes and suppresses removals after disposal", async () => {
    const started = deferred<void>()
    const result = deferred<SessionTabProbeResult>()
    let removals = 0
    const reconciler = createSessionTabReconciler({
      probe: () => {
        started.resolve(undefined)
        return result.promise
      },
      remove: () => {
        removals++
      },
    })

    const running = reconciler.reconcile([sessionTab("missing")])
    await started.promise
    reconciler.dispose()
    await running
    result.resolve("missing")
    await Promise.resolve()

    expect(removals).toBe(0)
    await reconciler.reconcile([sessionTab("missing")])
    expect(removals).toBe(0)
  })
})

describe("tab migration", () => {
  test("drops null and malformed persisted tabs", () => {
    expect(
      migrateTabs([null, sessionTab("a"), { type: "session", server }, { type: "unknown", server }, "invalid"], server),
    ).toEqual([sessionTab("a")])
  })

  test("adds the fallback server to valid legacy tabs", () => {
    expect(migrateTabs([{ type: "session", sessionId: "a", dirBase64: "legacy" }], server)).toEqual([sessionTab("a")])
  })

  test("replaces invalid top-level persisted data", () => {
    expect(migrateTabs(null, server)).toEqual([])
    expect(migrateTabs({}, server)).toEqual([])
  })
})

describe("tab memory", () => {
  test("keeps state until its tab is removed", () => {
    createRoot((dispose) => {
      const memory = createTabMemory(getOwner())
      let disposed = 0
      const first = memory.ensure("tab", "prompt", () => {
        onCleanup(() => disposed++)
        return { value: "prompt" }
      })

      expect(memory.ensure("tab", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.get<typeof first>("tab", "prompt")).toBe(first)
      expect(memory.get("missing", "prompt")).toBeUndefined()
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })
})

describe("draft readiness", () => {
  test("waits for readiness and deduplicates double-clicks into one tab", async () => {
    const ready = deferred<"ready" | "degraded">()
    const created: DraftTab[] = []
    const controller = createDraftReadinessController({
      ensureReady: () => ready.promise,
      createDraft: async (draft) => {
        const tab = { type: "draft" as const, draftID: "draft-1", ...draft }
        created.push(tab)
        return tab
      },
      openLegacy: async () => {},
      onError() {},
    })

    const first = controller.newDraft({ server, directory: "/project/" }, "first")
    const second = controller.newDraft({ server, directory: "/project" }, "second")

    expect(first).toBe(second)
    expect(controller.pending(server, "/project")).toBe(true)
    expect(created).toHaveLength(0)

    ready.resolve("ready")
    expect(await first).toEqual(created[0])
    expect(created).toHaveLength(1)
    expect(controller.pending(server, "/project/")).toBe(false)
  })

  test("creates no tab after a critical failure and allows retry", async () => {
    let attempts = 0
    const errors: unknown[] = []
    const created: DraftTab[] = []
    const controller = createDraftReadinessController({
      ensureReady: async () => {
        attempts++
        if (attempts === 1) throw new Error("config failed")
        return "degraded"
      },
      createDraft: async (draft) => {
        const tab = { type: "draft" as const, draftID: "draft-2", ...draft }
        created.push(tab)
        return tab
      },
      openLegacy: async () => {},
      onError: (error) => errors.push(error),
    })

    expect(await controller.newDraft({ server, directory: "/project" })).toBeUndefined()
    expect(created).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(controller.pending(server, "/project")).toBe(false)

    expect(await controller.newDraft({ server, directory: "/project" })).toEqual(created[0])
    expect(created).toHaveLength(1)
    expect(attempts).toBe(2)
  })

  test("keeps equal directories isolated across servers for Home, titlebar, and legacy entries", async () => {
    const localBootstrap = deferred<{ status: "ready"; errors: readonly Error[] }>()
    const remoteBootstrap = deferred<{ status: "degraded"; errors: readonly Error[] }>()
    const calls = { local: 0, remote: 0 }
    const readiness = new Map<ServerConnection.Key, ReturnType<typeof createWorkspaceReadinessController>>([
      [
        server,
        createWorkspaceReadinessController({
          scope: ServerScope.local,
          bootstrap: () => {
            calls.local++
            return localBootstrap.promise
          },
        }),
      ],
      [
        remoteServer,
        createWorkspaceReadinessController({
          scope: "https://windows.example" as ServerScope,
          bootstrap: () => {
            calls.remote++
            return remoteBootstrap.promise
          },
        }),
      ],
    ])
    const drafts: DraftTab[] = []
    const legacy: Array<{ server: ServerConnection.Key; directory: string }> = []
    const controller = createDraftReadinessController({
      ensureReady: (key, directory) => {
        const target = readiness.get(key)
        if (!target) throw new Error("server readiness required")
        return target.ensureReady(directory)
      },
      createDraft: async (draft) => {
        const tab = { type: "draft" as const, draftID: `draft-${drafts.length + 1}`, ...draft }
        drafts.push(tab)
        return tab
      },
      openLegacy: async (target) => {
        legacy.push(target)
      },
      onError() {},
    })

    const home = controller.newDraft({ server, directory: "/project/" })
    const homeAgain = controller.newDraft({ server, directory: "/project" })
    const oldTitlebar = controller.openLegacy({ server: remoteServer, directory: "/project/" })
    const legacyHome = controller.openLegacy({ server: remoteServer, directory: "/project" })
    const sessionCommand = controller.openLegacy({ server: remoteServer, directory: "/project/" })
    const compatibilityRoute = controller.prepare({ server: remoteServer, directory: "/project" })

    expect(homeAgain).toBe(home)
    expect(legacyHome).toBe(oldTitlebar)
    expect(sessionCommand).toBe(oldTitlebar)
    await Promise.resolve()
    expect(calls).toEqual({ local: 1, remote: 1 })
    expect(controller.pending(server, "/project")).toBe(true)
    expect(controller.pending(remoteServer, "/project")).toBe(true)

    localBootstrap.resolve({ status: "ready", errors: [] })
    remoteBootstrap.resolve({ status: "degraded", errors: [new Error("provider failed")] })
    expect(await home).toEqual(drafts[0])
    expect(await oldTitlebar).toBe(true)
    expect(await compatibilityRoute).toBe("degraded")
    expect(drafts).toHaveLength(1)
    expect(legacy).toEqual([{ server: remoteServer, directory: "/project/" }])
    expect(controller.pending(server, "/project")).toBe(false)
    expect(controller.pending(remoteServer, "/project")).toBe(false)
  })

  test("keeps legacy navigation in place after failure and retries on the next command", async () => {
    let attempts = 0
    const errors: unknown[] = []
    const opened: string[] = []
    const controller = createDraftReadinessController({
      ensureReady: async () => {
        attempts++
        if (attempts === 1) throw new Error("config failed")
        return "ready"
      },
      createDraft: async (draft) => ({ type: "draft", draftID: "unused", ...draft }),
      openLegacy: async (target) => {
        opened.push(target.directory)
      },
      onError: (error) => errors.push(error),
    })

    expect(await controller.openLegacy({ server, directory: "/project" })).toBeUndefined()
    expect(opened).toEqual([])
    expect(errors).toHaveLength(1)
    expect(controller.pending(server, "/project")).toBe(false)

    expect(await controller.openLegacy({ server, directory: "/project" })).toBe(true)
    expect(opened).toEqual(["/project"])
    expect(attempts).toBe(2)
  })
})

describe("closed tab stack", () => {
  test("records session tabs with their index", () => {
    const stack = pushClosedTab([], sessionTab("a"), 2)

    expect(stack).toEqual([{ tab: sessionTab("a"), index: 2 }])
  })

  test("ignores draft tabs", () => {
    const draft: Tab = { type: "draft", draftID: "d1", server, directory: "/tmp" }

    expect(pushClosedTab([], draft, 0)).toEqual([])
  })

  test("caps the stack size", () => {
    const stack = Array.from({ length: 30 }, (_, i) => i).reduce<ClosedTab[]>(
      (acc, i) => pushClosedTab(acc, sessionTab(`s${i}`), i),
      [],
    )

    expect(stack).toHaveLength(25)
    expect(stack[0]?.tab.sessionId).toBe("s5")
    expect(stack.at(-1)?.tab.sessionId).toBe("s29")
  })

  test("pops the most recently closed tab", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]
    const result = takeClosedTab(stack, [])

    expect(result.entry?.tab.sessionId).toBe("b")
    expect(result.stack).toEqual([{ tab: sessionTab("a"), index: 0 }])
  })

  test("skips entries whose tab is already open", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]
    const result = takeClosedTab(stack, [sessionTab("b")])

    expect(result.entry?.tab.sessionId).toBe("a")
    expect(result.stack).toEqual([])
  })

  test("returns no entry when everything is open or empty", () => {
    expect(takeClosedTab([], []).entry).toBeUndefined()

    const result = takeClosedTab([{ tab: sessionTab("a"), index: 0 }], [sessionTab("a")])
    expect(result.entry).toBeUndefined()
    expect(result.stack).toEqual([])
  })

  test("purges removed sessions", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    expect(removeClosedTabs(stack, server, ["a"])).toEqual([{ tab: sessionTab("b"), index: 1 }])
  })

  test("does not navigate when a background tab closes", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]

    expect(nextTabAfterClose(tabs, 1, false)).toBeUndefined()
    expect(nextTabAfterClose(tabs, 1, true)).toEqual(sessionTab("c"))
    expect(nextTabAfterClose([sessionTab("a")], 0, true)).toBeNull()
  })
})

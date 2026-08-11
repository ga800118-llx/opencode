import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./tab-memory"
import { nextTabAfterClose, pushClosedTab, removeClosedTabs, takeClosedTab, type ClosedTab } from "./closed-tabs"
import { createDraftReadinessController, type DraftTab, type SessionTab, type Tab } from "./tabs"
import { migrateTabs } from "./tab-migration"
import type { ServerConnection } from "./server"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key

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

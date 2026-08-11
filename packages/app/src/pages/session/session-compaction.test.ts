import { describe, expect, test } from "bun:test"
import {
  createSessionCompaction,
  sessionCompactionDescriptionKey,
  type SessionCompactionRequest,
} from "./session-compaction"

function fixture(overrides?: {
  sessionID?: string
  visibleUserMessage?: boolean
  model?: { providerID: string; modelID: string } | null
  working?: boolean
  compact?: (request: SessionCompactionRequest) => Promise<unknown>
}) {
  const requests: SessionCompactionRequest[] = []
  const action = createSessionCompaction({
    sessionID: () => overrides?.sessionID ?? "session-1",
    hasVisibleUserMessage: () => overrides?.visibleUserMessage ?? true,
    model: () =>
      overrides?.model === null ? undefined : (overrides?.model ?? { providerID: "provider-1", modelID: "model-1" }),
    working: () => overrides?.working ?? false,
    compact: async (request) => {
      requests.push(request)
      return overrides?.compact?.(request)
    },
  })
  return { action, requests }
}

describe("createSessionCompaction", () => {
  test("maps every disabled reason to specific feedback copy", () => {
    expect(sessionCompactionDescriptionKey(undefined)).toBe("command.session.compact.description")
    expect(sessionCompactionDescriptionKey("no-session")).toBe("context.compact.disabled.noSession")
    expect(sessionCompactionDescriptionKey("no-user-message")).toBe("context.compact.disabled.noUserMessage")
    expect(sessionCompactionDescriptionKey("no-model")).toBe("toast.model.none.description")
    expect(sessionCompactionDescriptionKey("working")).toBe("context.compact.disabled.working")
    expect(sessionCompactionDescriptionKey("pending")).toBe("context.compact.disabled.pending")
  })

  test("disables without a session and sends no request", async () => {
    const { action, requests } = fixture({ sessionID: "" })

    expect(action.disabledReason()).toBe("no-session")
    expect(await action.run()).toEqual({ status: "disabled", reason: "no-session" })
    expect(requests).toEqual([])
  })

  test("disables without a visible user message", async () => {
    const { action, requests } = fixture({ visibleUserMessage: false })

    expect(action.disabledReason()).toBe("no-user-message")
    expect(await action.run()).toEqual({ status: "disabled", reason: "no-user-message" })
    expect(requests).toEqual([])
  })

  test("reports the no-model reason without a request", async () => {
    const { action, requests } = fixture({ model: null })

    expect(action.disabledReason()).toBe("no-model")
    expect(await action.run()).toEqual({ status: "disabled", reason: "no-model" })
    expect(requests).toEqual([])
  })

  test("disables while the session is working", async () => {
    const { action, requests } = fixture({ working: true })

    expect(action.disabledReason()).toBe("working")
    expect(await action.run()).toEqual({ status: "disabled", reason: "working" })
    expect(requests).toEqual([])
  })

  test("deduplicates concurrent calls and sends the exact session and model", async () => {
    let resolve: (() => void) | undefined
    const compacted = new Promise<void>((done) => {
      resolve = done
    })
    const { action, requests } = fixture({ compact: () => compacted })

    const first = action.run()
    const second = action.run()

    expect(action.pending()).toBe(true)
    expect(action.disabledReason()).toBe("pending")
    await Promise.resolve()
    expect(requests).toEqual([
      {
        sessionID: "session-1",
        model: { providerID: "provider-1", modelID: "model-1" },
      },
    ])

    resolve?.()
    expect(await first).toEqual({ status: "success" })
    expect(await second).toEqual({ status: "success" })
    expect(action.pending()).toBe(false)
  })

  test("shares one in-flight request across separate controllers", async () => {
    let resolve: (() => void) | undefined
    const compacted = new Promise<void>((done) => {
      resolve = done
    })
    let calls = 0
    const compact = () => {
      calls += 1
      return compacted
    }
    const first = fixture({ sessionID: "shared-session", compact }).action
    const second = fixture({ sessionID: "shared-session", compact }).action

    const firstResult = first.run()
    const secondResult = second.run()

    expect(first.pending()).toBe(true)
    expect(second.pending()).toBe(true)
    await Promise.resolve()
    expect(calls).toBe(1)

    resolve?.()
    expect(await firstResult).toEqual({ status: "success" })
    expect(await secondResult).toEqual({ status: "success" })
    expect(first.pending()).toBe(false)
    expect(second.pending()).toBe(false)
  })

  test("returns an error and clears pending without changing caller state", async () => {
    const context = { usage: 90 }
    const failure = new Error("compact failed")
    const { action } = fixture({ compact: async () => Promise.reject(failure) })

    expect(await action.run()).toEqual({ status: "error", error: failure })
    expect(action.pending()).toBe(false)
    expect(context).toEqual({ usage: 90 })
  })

  test("converts synchronous API failures into recoverable results", async () => {
    const failure = new Error("sync compact failed")
    const { action } = fixture({
      compact: () => {
        throw failure
      },
    })

    expect(await action.run()).toEqual({ status: "error", error: failure })
    expect(action.pending()).toBe(false)
  })
})

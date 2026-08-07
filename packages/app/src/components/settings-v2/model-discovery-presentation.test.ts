import { describe, expect, test } from "bun:test"
import type { ProductErrorKind } from "@/product/contracts"
import type { ModelDiscoveryFeedback } from "./model-center-controller"
import { createModelDiscoveryCoordinator, modelDiscoveryPresentation } from "./model-discovery-presentation"

describe("model discovery presentation", () => {
  test("presents progress before completed feedback", () => {
    expect(modelDiscoveryPresentation(true, { type: "success", count: 3 })).toEqual({
      key: "settings.modelCenter.discovery.progress",
      live: "polite",
      tone: "progress",
    })
  })

  test("presents successful discovery counts and the zero-model response", () => {
    expect(modelDiscoveryPresentation(false, { type: "success", count: 2 })).toEqual({
      key: "settings.modelCenter.discovery.success",
      params: { count: 2 },
      live: "polite",
      tone: "success",
    })
    expect(modelDiscoveryPresentation(false, { type: "success", count: 0 })).toEqual({
      key: "settings.modelCenter.discovery.empty",
      live: "polite",
      tone: "success",
    })
  })

  test("presents invalid endpoints without diagnostic input", () => {
    expect(modelDiscoveryPresentation(false, { type: "invalid-endpoint" })).toEqual({
      key: "settings.modelCenter.discovery.invalidEndpoint",
      live: "assertive",
      tone: "error",
    })
  })

  test.each([
    ["unreachable-endpoint", "settings.modelCenter.discovery.unreachableEndpoint"],
    ["authentication", "settings.modelCenter.discovery.authentication"],
    ["incompatible-api", "settings.modelCenter.discovery.incompatible"],
    ["timeout", "settings.modelCenter.discovery.timeout"],
    ["tls", "settings.modelCenter.discovery.tls"],
    ["missing-model", "settings.modelCenter.discovery.missingModel"],
    ["aborted", "settings.modelCenter.discovery.aborted"],
  ] as const)("maps %s diagnostics to safe localized copy", (kind, key) => {
    expect(modelDiscoveryPresentation(false, diagnostic(kind))).toEqual({ key, live: "assertive", tone: "error" })
  })

  test.each(["streaming", "tool-calling", "server-crash", "unknown"] as const)(
    "maps %s diagnostics to unexpected copy",
    (kind) => {
      expect(modelDiscoveryPresentation(false, diagnostic(kind))).toEqual({
        key: "settings.modelCenter.discovery.unexpected",
        live: "assertive",
        tone: "error",
      })
    },
  )

  test("presents unexpected failures and omits empty state", () => {
    expect(modelDiscoveryPresentation(false, { type: "unexpected" })).toEqual({
      key: "settings.modelCenter.discovery.unexpected",
      live: "assertive",
      tone: "error",
    })
    expect(modelDiscoveryPresentation(false, undefined)).toBeUndefined()
  })
})

describe("model discovery coordination", () => {
  test("scrolls active progress and completed feedback", async () => {
    const fixture = coordinationFixture()
    const discovery = deferred<void>()
    const completion = fixture.run(() => {
      fixture.state.discovering = true
      return discovery.promise.finally(() => {
        fixture.state.discovering = false
      })
    })

    fixture.flush()
    expect(fixture.state.scrolls).toBe(1)

    fixture.state.feedback = true
    discovery.resolve()
    await completion
    fixture.flush()
    expect(fixture.state.scrolls).toBe(2)
  })

  test("scrolls current feedback after undefined and rejected completions", async () => {
    const invalid = coordinationFixture()
    await invalid.run(() => {
      invalid.state.feedback = true
      return Promise.resolve(undefined)
    })
    invalid.flush()
    expect(invalid.state.scrolls).toBe(1)

    const unexpected = coordinationFixture()
    await unexpected.run(() => {
      unexpected.state.feedback = true
      return Promise.reject(new Error("discovery failed"))
    })
    unexpected.flush()
    expect(unexpected.state.scrolls).toBe(1)
  })

  test("does not scroll after a mutation clears in-progress feedback", async () => {
    const fixture = coordinationFixture()
    const discovery = deferred<void>()
    const completion = fixture.run(() => {
      fixture.state.discovering = true
      return discovery.promise
    })

    fixture.state.discovering = false
    fixture.state.feedback = false
    discovery.resolve()
    await completion
    fixture.flush()

    expect(fixture.state.scrolls).toBe(0)
  })

  test("rechecks feedback before a completion frame scrolls", async () => {
    const fixture = coordinationFixture()
    await fixture.run(() => {
      fixture.state.feedback = true
      return Promise.resolve(undefined)
    })

    fixture.state.feedback = false
    fixture.flush()
    expect(fixture.state.scrolls).toBe(0)
  })

  test("ignores an older completion after a newer attempt produces feedback", async () => {
    const fixture = coordinationFixture()
    const first = deferred<void>()
    const second = deferred<void>()
    const firstCompletion = fixture.run(() => {
      fixture.state.discovering = true
      return first.promise
    })
    const secondCompletion = fixture.run(() => second.promise)

    fixture.state.discovering = false
    fixture.state.feedback = true
    second.resolve()
    await secondCompletion
    fixture.flush()
    expect(fixture.state.scrolls).toBe(1)

    first.resolve()
    await firstCompletion
    fixture.flush()
    expect(fixture.state.scrolls).toBe(1)
  })
})

function diagnostic(kind: ProductErrorKind): ModelDiscoveryFeedback {
  return {
    type: "diagnostic",
    diagnostic: {
      kind,
      message: "secret diagnostic body",
      detail: "Authorization: Bearer secret",
      requestID: "req-secret",
    },
  }
}

function coordinationFixture() {
  const state = { discovering: false, feedback: false, scrolls: 0 }
  const frames: Array<() => void> = []
  return {
    state,
    run: createModelDiscoveryCoordinator({
      discovering: () => state.discovering,
      hasFeedback: () => state.feedback,
      schedule: (callback) => frames.push(callback),
      scroll: () => {
        state.scrolls += 1
      },
    }),
    flush() {
      frames.splice(0).forEach((callback) => callback())
    },
  }
}

function deferred<T>() {
  const result = Promise.withResolvers<T>()
  return {
    promise: result.promise,
    resolve: result.resolve,
  }
}

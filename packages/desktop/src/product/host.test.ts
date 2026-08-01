import { describe, expect, test } from "bun:test"
import {
  PRODUCT_HOST_CHANNELS,
  createDesktopProductHost,
  createProductCredentialCapabilities,
  sanitizeProductSidecarStatus,
  type DesktopProductHostAPI,
  type ProductSidecarStatus,
} from "./host"

describe("desktop product host", () => {
  test("publishes an exact lifecycle IPC allow list", () => {
    expect(PRODUCT_HOST_CHANNELS).toEqual({
      sidecarGetStatus: "product-sidecar-get-status",
      sidecarSubscribe: "product-sidecar-subscribe",
      sidecarUnsubscribe: "product-sidecar-unsubscribe",
      sidecarState: "product-sidecar-state",
      sidecarRestart: "product-sidecar-restart",
      credentialGetCapabilities: "product-credential-get-capabilities",
    })
    expect(Object.keys(PRODUCT_HOST_CHANNELS)).not.toContain("credentialRead")
    expect(Object.keys(PRODUCT_HOST_CHANNELS)).not.toContain("credentialWrite")
  })

  test("whitelists status fields and rebuilds safe errors", () => {
    const status = sanitizeProductSidecarStatus({
      status: "restarting",
      attempt: 2,
      changedAt: 100,
      startedAt: 90,
      nextRetryAt: 120,
      url: "http://opencode:raw-password@127.0.0.1:4096",
      password: "raw-password",
      authorization: "Basic raw-secret",
      environment: { API_KEY: "raw-secret" },
      error: {
        kind: "exit",
        message: "Bearer raw-secret",
        stack: "password=raw-password",
        exitCode: 17,
      },
    })

    expect(status).toEqual({
      state: "restarting",
      attempt: 2,
      changedAt: 100,
      startedAt: 90,
      nextRetryAt: 120,
      error: {
        kind: "exit",
        message: "The local agent server stopped unexpectedly.",
        exitCode: 17,
      },
    })
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain("raw-secret")
    expect(serialized).not.toContain("raw-password")
    expect(serialized).not.toContain("authorization")
    expect(serialized).not.toContain("API_KEY")
  })

  test("rejects malformed counters, timestamps, states, and errors", () => {
    expect(
      sanitizeProductSidecarStatus(
        {
          state: "ready-with-password",
          attempt: Number.POSITIVE_INFINITY,
          changedAt: -1,
          readyAt: Number.NaN,
          error: { kind: "credential", message: "raw-secret" },
        },
        50,
      ),
    ).toEqual({ state: "unavailable", attempt: 0, changedAt: 50 })
  })

  test("declares credential backends without enabling secret operations", () => {
    const mac = createProductCredentialCapabilities("dev.agent.desktop.credentials", "darwin")
    const windows = createProductCredentialCapabilities("dev.agent.desktop.credentials", "win32")
    const linux = createProductCredentialCapabilities("dev.agent.desktop.credentials", "linux")

    expect(mac).toMatchObject({ backend: "macos-keychain", available: false })
    expect(windows).toMatchObject({ backend: "windows-credential-manager", available: false })
    expect(linux).toMatchObject({ backend: "unsupported", available: false })
    expect(mac.operations).toEqual({ read: false, write: false, delete: false })
  })

  test("creates a frozen host that delegates lifecycle operations", async () => {
    const ready: ProductSidecarStatus = { state: "ready", attempt: 0, changedAt: 1, readyAt: 1 }
    const calls: string[] = []
    const api: DesktopProductHostAPI = {
      sidecar: {
        async getStatus() {
          calls.push("get")
          return ready
        },
        async subscribe(listener) {
          calls.push("subscribe")
          listener(ready)
          return () => calls.push("unsubscribe")
        },
        async restart() {
          calls.push("restart")
          return ready
        },
      },
      credentials: {
        async getCapabilities() {
          calls.push("credentials")
          return createProductCredentialCapabilities("dev.agent.desktop.credentials", "darwin")
        },
      },
    }
    const host = createDesktopProductHost(api)

    expect(host.kind).toBe("desktop")
    expect(await host.sidecar.getStatus()).toBe(ready)
    const unsubscribe = await host.sidecar.subscribe(() => calls.push("state"))
    expect(await host.sidecar.restart()).toBe(ready)
    expect((await host.credentials.getCapabilities()).namespace).toBe("dev.agent.desktop.credentials")
    unsubscribe()
    expect(calls).toEqual(["get", "subscribe", "state", "restart", "credentials", "unsubscribe"])
    expect(Object.isFrozen(host)).toBe(true)
    expect(Object.isFrozen(host.sidecar)).toBe(true)
  })
})

import { describe, expect, test } from "bun:test"
import { createProductHostPreloadAPI, type ProductHostPreloadTransport } from "./product-host"
import type { ProductSidecarStatus } from "../product/host"

const ready: ProductSidecarStatus = { state: "ready", attempt: 0, changedAt: 1, readyAt: 1 }

function createTransport() {
  const calls: string[] = []
  let listener: ((status: ProductSidecarStatus) => void) | undefined
  let rejectNextSubscribe = false
  const transport: ProductHostPreloadTransport = {
    async getSidecarStatus() {
      calls.push("get")
      return ready
    },
    async subscribeSidecar() {
      calls.push("subscribe")
      if (!rejectNextSubscribe) return
      rejectNextSubscribe = false
      throw new Error("subscribe failed")
    },
    async unsubscribeSidecar() {
      calls.push("unsubscribe")
    },
    async restartSidecar() {
      calls.push("restart")
      return ready
    },
    async getCredentialCapabilities() {
      calls.push("credentials")
      return {
        namespace: "dev.agent.desktop.credentials",
        backend: "macos-keychain",
        available: false,
        operations: { read: false, write: false, delete: false },
      }
    },
    async modelCenterCapabilities() {
      calls.push("model-center-capabilities")
      return {
        available: true,
        credentialBackend: "macos-keychain",
        credentialOperations: { read: true, write: true, delete: true },
        localDetection: true,
      }
    },
    async modelCenterList() {
      calls.push("model-center-list")
      return []
    },
    async modelCenterSave() {
      throw new Error("unused")
    },
    async modelCenterRemove() {},
    async modelCenterDiscover() {
      return { models: [], requestID: "req-safe" }
    },
    async modelCenterTest() {
      throw new Error("unused")
    },
    async modelCenterDetectLocal() {
      calls.push("model-center-detect")
      return []
    },
    async modelCenterSelectDefault() {
      throw new Error("unused")
    },
    async modelCenterReloadCredentials() {
      calls.push("model-center-reload")
    },
    listenSidecar(next) {
      calls.push("listen")
      listener = next
      return () => {
        calls.push("stop-listening")
        listener = undefined
      }
    },
  }

  return {
    calls,
    transport,
    emit(status: ProductSidecarStatus) {
      listener?.(status)
    },
    rejectNextSubscribe() {
      rejectNextSubscribe = true
    },
  }
}

describe("product host preload API", () => {
  test("shares one renderer subscription and isolates callback failures", async () => {
    const fake = createTransport()
    const api = createProductHostPreloadAPI(fake.transport)
    const states: ProductSidecarStatus[] = []
    const first = await api.sidecar.subscribe(() => {
      throw new Error("listener failed")
    })
    const second = await api.sidecar.subscribe((status) => states.push(status))

    fake.emit(ready)
    first()
    expect(fake.calls).not.toContain("unsubscribe")
    second()
    await Promise.resolve()

    expect(states).toEqual([ready])
    expect(fake.calls).toEqual(["listen", "subscribe", "stop-listening", "unsubscribe"])
  })

  test("cleans up a failed subscription and allows a later retry", async () => {
    const fake = createTransport()
    const api = createProductHostPreloadAPI(fake.transport)
    fake.rejectNextSubscribe()

    await expect(api.sidecar.subscribe(() => undefined)).rejects.toThrow("subscribe failed")
    const unsubscribe = await api.sidecar.subscribe(() => undefined)
    unsubscribe()
    await Promise.resolve()

    expect(fake.calls).toEqual([
      "listen",
      "subscribe",
      "stop-listening",
      "listen",
      "subscribe",
      "stop-listening",
      "unsubscribe",
    ])
  })

  test("delegates the exact model-center preload surface", async () => {
    const fake = createTransport()
    const api = createProductHostPreloadAPI(fake.transport)

    expect((await api.modelCenter.capabilities()).available).toBe(true)
    expect(await api.modelCenter.list()).toEqual([])
    expect(await api.modelCenter.detectLocal()).toEqual([])
    await api.modelCenter.reloadCredentials()

    expect(fake.calls).toEqual([
      "model-center-capabilities",
      "model-center-list",
      "model-center-detect",
      "model-center-reload",
    ])
  })
})

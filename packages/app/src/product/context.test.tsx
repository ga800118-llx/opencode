import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import type { CompatibleApi } from "@/utils/server-compat"
import type { ProductTaskAdapter } from "./contracts"
import {
  BROWSER_PRODUCT_RUNTIME,
  createRuntimeTaskAdapter,
  resolveProductRuntime,
  type ProductRuntime,
} from "./context"

describe("ProductRuntimeProvider", () => {
  test("defaults browser and test hosts to the standard adapter factory", () => {
    expect(resolveProductRuntime()).toBe(BROWSER_PRODUCT_RUNTIME)
    expect(BROWSER_PRODUCT_RUNTIME.host.kind).toBe("browser")
    expect(BROWSER_PRODUCT_RUNTIME.host.modelCenter.capabilities()).resolves.toEqual({
      available: false,
      credentialBackend: "unsupported",
      credentialOperations: { read: false, write: false, delete: false },
      localDetection: false,
    })
  })

  test("uses an injected typed runtime without host secrets", () => {
    const adapter = {} as ProductTaskAdapter<SessionInfo>
    const calls: CompatibleApi[] = []
    const runtime = {
      host: { kind: "desktop", modelCenter: BROWSER_PRODUCT_RUNTIME.host.modelCenter },
      createTaskAdapter(api) {
        calls.push(api)
        return adapter
      },
    } satisfies ProductRuntime
    const api = {} as CompatibleApi

    expect(resolveProductRuntime(runtime)).toBe(runtime)
    expect(createRuntimeTaskAdapter(runtime, api)).toBe(adapter)
    expect(calls).toEqual([api])
    expect(Object.keys(runtime.host)).toEqual(["kind", "modelCenter"])
  })
})

import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import type { CompatibleApi } from "@/utils/server-compat"
import type { ProductTaskAdapter } from "./contracts"
import {
  BROWSER_PRODUCT_RUNTIME,
  createRuntimeTaskAdapter,
  ProductRuntimeProvider,
  type ProductRuntime,
  useProductRuntime,
} from "./context"
import { render } from "solid-js/web"

function captureRuntime(runtime?: ProductRuntime) {
  const root = document.createElement("div")
  let captured: ProductRuntime | undefined
  const Capture = () => {
    captured = useProductRuntime()
    return null
  }
  const dispose = render(
    () => (
      <ProductRuntimeProvider runtime={runtime}>
        <Capture />
      </ProductRuntimeProvider>
    ),
    root,
  )
  dispose()
  return captured
}

describe("ProductRuntimeProvider", () => {
  test("defaults browser and test hosts to the standard adapter factory", () => {
    expect(captureRuntime()).toBe(BROWSER_PRODUCT_RUNTIME)
    expect(BROWSER_PRODUCT_RUNTIME.host).toEqual({ kind: "browser" })
  })

  test("uses an injected typed runtime without host secrets", () => {
    const adapter = {} as ProductTaskAdapter<SessionInfo>
    const calls: CompatibleApi[] = []
    const runtime = {
      host: { kind: "desktop" },
      createTaskAdapter(api) {
        calls.push(api)
        return adapter
      },
    } satisfies ProductRuntime
    const api = {} as CompatibleApi

    expect(captureRuntime(runtime)).toBe(runtime)
    expect(createRuntimeTaskAdapter(runtime, api)).toBe(adapter)
    expect(calls).toEqual([api])
    expect(Object.keys(runtime.host)).toEqual(["kind"])
  })
})

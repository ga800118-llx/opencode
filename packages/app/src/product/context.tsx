import type { SessionInfo } from "@opencode-ai/client/promise"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { useSDK } from "@/context/sdk"
import type { CompatibleApi } from "@/utils/server-compat"
import type { ProductTaskAdapter } from "./contracts"
import { createProductTaskAdapter } from "./task-adapter"

export type ProductHost = {
  readonly kind: "browser" | "desktop"
}

export type ProductTaskAdapterFactory = (api: CompatibleApi) => ProductTaskAdapter<SessionInfo>

export type ProductRuntime<Host extends ProductHost = ProductHost> = {
  readonly host: Host
  readonly createTaskAdapter: ProductTaskAdapterFactory
}

export const BROWSER_PRODUCT_RUNTIME = Object.freeze({
  host: Object.freeze({ kind: "browser" as const }),
  createTaskAdapter: createProductTaskAdapter,
}) satisfies ProductRuntime

export function createRuntimeTaskAdapter(runtime: ProductRuntime, api: CompatibleApi) {
  return runtime.createTaskAdapter(api)
}

export const { use: useProductRuntime, provider: ProductRuntimeProvider } = createSimpleContext({
  name: "ProductRuntime",
  init: (props: { runtime?: ProductRuntime }) => props.runtime ?? BROWSER_PRODUCT_RUNTIME,
})

export function useProductTaskAdapter() {
  const runtime = useProductRuntime()
  const sdk = useSDK()
  return createMemo(() => createRuntimeTaskAdapter(runtime, sdk().api))
}

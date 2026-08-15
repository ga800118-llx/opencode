import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"

const emptyProviderCatalog: NormalizedProviderListResponse = { all: new Map(), connected: [], default: {} }

export function providerQueryReady(query: { isSuccess: boolean; fetchStatus: "fetching" | "paused" | "idle" }) {
  return query.isSuccess && query.fetchStatus === "idle"
}

export function resolveProviderCatalog(input: {
  directoryReady: boolean
  directory?: NormalizedProviderListResponse
  globalReady: boolean
  global: NormalizedProviderListResponse
}) {
  if (!input.directoryReady) return { ready: false, providers: emptyProviderCatalog }
  if (input.directory && input.directory.all.size > 0) return { ready: true, providers: input.directory }
  if (!input.globalReady) return { ready: false, providers: emptyProviderCatalog }
  return { ready: true, providers: input.global }
}

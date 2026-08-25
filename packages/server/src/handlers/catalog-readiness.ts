import { PluginInternal } from "@opencode-ai/core/plugin/internal"
import { Effect } from "effect"

export const waitForCatalogReady = Effect.gen(function* () {
  const plugin = yield* PluginInternal.Service
  yield* plugin.wait()
})

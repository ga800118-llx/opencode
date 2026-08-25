import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Effect } from "effect"

export const waitForCatalogReady = Effect.gen(function* () {
  const plugin = yield* PluginV2.Service
  yield* plugin.wait(PluginV2.ID.make(ConfigProviderPlugin.Plugin.id))
})

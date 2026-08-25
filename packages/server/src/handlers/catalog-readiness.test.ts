import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Option } from "effect"
import { waitForCatalogReady } from "./catalog-readiness"

test("waits for the config provider plugin", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void, never>()
      const requested: PluginV2.ID[] = []
      const plugin = PluginV2.Service.of({
        add: () => Effect.void,
        remove: () => Effect.void,
        wait: (id) =>
          Effect.sync(() => requested.push(id)).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.asVoid,
          ),
      })
      const waiting = yield* waitForCatalogReady.pipe(
        Effect.provideService(PluginV2.Service, plugin),
        Effect.forkChild,
      )

      yield* Effect.yieldNow
      expect(requested).toEqual([PluginV2.ID.make(ConfigProviderPlugin.Plugin.id)])
      expect(Option.isNone(yield* Fiber.await(waiting).pipe(Effect.timeoutOption("10 millis")))).toBe(true)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(waiting)
    }),
  )
})

import { PluginInternal } from "@opencode-ai/core/plugin/internal"
import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { waitForCatalogReady } from "./catalog-readiness"

test("waits for internal plugin boot", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void, never>()
      const called = yield* Deferred.make<void, never>()
      const plugin = PluginInternal.Service.of({
        wait: () => Deferred.succeed(called, undefined).pipe(Effect.andThen(Deferred.await(gate))),
      })
      const waiting = yield* waitForCatalogReady.pipe(
        Effect.provideService(PluginInternal.Service, plugin),
        Effect.forkChild,
      )

      yield* Deferred.await(called)
      expect(waiting.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(waiting)
    }),
  )
})

test("propagates internal plugin boot defects", async () => {
  const defect = new Error("plugin boot failed")
  const exit = await Effect.runPromise(
    waitForCatalogReady.pipe(
      Effect.provideService(
        PluginInternal.Service,
        PluginInternal.Service.of({ wait: () => Effect.die(defect) }),
      ),
      Effect.exit,
    ),
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(defect)
})

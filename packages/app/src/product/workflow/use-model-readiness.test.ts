import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createModelReadinessController } from "./use-model-readiness"

const model = (providerID = "opencode", modelID = "big-pickle") => ({ providerID, modelID })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createModelReadinessController", () => {
  test("stays loading until provider, model, and host capability state resolve", async () => {
    const capability = deferred<{ available: boolean }>()
    const [providersReady, setProvidersReady] = createSignal(false)
    const [modelsReady, setModelsReady] = createSignal(false)

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createModelReadinessController({
          providersReady,
          modelsReady,
          selectedModel: () => undefined,
          models: () => [],
          loadModelCenterCapabilities: () => capability.promise,
        })

        expect(controller.readiness()).toBe("loading")
        setProvidersReady(true)
        setModelsReady(true)
        expect(controller.readiness()).toBe("loading")

        capability.resolve({ available: true })
        void settle().then(() => {
          expect(controller.readiness()).toBe("setup-required")
          dispose()
          done()
        })
      })
    })
  })

  test("treats a hydrated usable model as ready before host capabilities resolve", () => {
    const capability = deferred<{ available: boolean }>()
    const [selectedModel] = createSignal(model())
    let calls = 0

    createRoot((dispose) => {
      const controller = createModelReadinessController({
        providersReady: () => true,
        modelsReady: () => true,
        selectedModel,
        models: () => [],
        loadModelCenterCapabilities: () => {
          calls++
          return capability.promise
        },
      })

      expect(controller.readiness()).toBe("ready")
      expect(calls).toBe(1)
      dispose()
    })
  })

  test("keeps connected models ready when all are hidden from the selector", async () => {
    const connected = [model("builtin", "free"), model("private", "coder"), model("local", "qwen")]

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createModelReadinessController({
          providersReady: () => true,
          modelsReady: () => true,
          selectedModel: () => undefined,
          models: () => connected,
          loadModelCenterCapabilities: async () => ({ available: true }),
        })

        void settle().then(() => {
          expect(controller.availableModelCount()).toBe(3)
          expect(controller.readiness()).toBe("ready")
          dispose()
          done()
        })
      })
    })
  })

  test("loads host capabilities once instead of probing on reactive updates", async () => {
    const [models, setModels] = createSignal<ReturnType<typeof model>[]>([])
    let calls = 0

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createModelReadinessController({
          providersReady: () => true,
          modelsReady: () => true,
          selectedModel: () => undefined,
          models,
          loadModelCenterCapabilities: async () => {
            calls++
            return { available: true }
          },
        })

        void settle().then(() => {
          expect(controller.readiness()).toBe("setup-required")
          setModels([model()])
          expect(controller.readiness()).toBe("ready")
          setModels([])
          expect(controller.readiness()).toBe("setup-required")
          expect(calls).toBe(1)
          dispose()
          done()
        })
      })
    })
  })

  test("uses the preserved provider route when the desktop model center is unavailable", async () => {
    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createModelReadinessController({
          providersReady: () => true,
          modelsReady: () => true,
          selectedModel: () => undefined,
          models: () => [],
          loadModelCenterCapabilities: async () => ({ available: false }),
        })

        void settle().then(() => {
          expect(controller.readiness()).toBe("desktop-unavailable")
          dispose()
          done()
        })
      })
    })
  })
})

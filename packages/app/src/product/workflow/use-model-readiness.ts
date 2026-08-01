import { createSignal, onCleanup, type Accessor } from "solid-js"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { useProductRuntime } from "@/product/context"
import { modelReadiness } from "./model-readiness"

export type ModelReadinessModel = {
  readonly providerID: string
  readonly modelID: string
}

export type ModelReadinessControllerInput = {
  readonly providersReady: Accessor<boolean>
  readonly modelsReady: Accessor<boolean>
  readonly selectedModel: Accessor<ModelReadinessModel | undefined>
  readonly models: Accessor<readonly ModelReadinessModel[]>
  readonly visible: (model: ModelReadinessModel) => boolean
  readonly loadModelCenterCapabilities: () => Promise<{ readonly available: boolean }>
}

export function createModelReadinessController(input: ModelReadinessControllerInput) {
  const [desktopModelCenterAvailable, setDesktopModelCenterAvailable] = createSignal<boolean>()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  void input.loadModelCenterCapabilities().then(
    (capabilities) => {
      if (!disposed) setDesktopModelCenterAvailable(capabilities.available)
    },
    () => {
      if (!disposed) setDesktopModelCenterAvailable(false)
    },
  )
  const availableModelCount = () => input.models().filter(input.visible).length
  const readiness = () =>
    modelReadiness({
      providersLoading:
        !input.providersReady() || !input.modelsReady() || desktopModelCenterAvailable() === undefined,
      hasUsableSelectedModel: !!input.selectedModel(),
      availableModelCount: availableModelCount(),
      desktopModelCenterAvailable: desktopModelCenterAvailable() ?? false,
    })

  return {
    readiness,
    availableModelCount,
  }
}

export function useModelReadiness(input: {
  directory?: Accessor<string | undefined>
  model?: {
    readonly ready: Accessor<boolean>
    readonly current: Accessor<{ readonly provider: { readonly id: string }; readonly id: string } | undefined>
  }
} = {}) {
  const runtime = useProductRuntime()
  const serverSync = useServerSync()
  const providers = useProviders(() => input.directory?.())
  const models = useModels()

  return createModelReadinessController({
    providersReady: () => {
      const directory = input.directory?.()
      if (directory) return serverSync().child(directory)[0].provider_ready
      return serverSync().data.ready
    },
    modelsReady: input.model?.ready ?? models.ready,
    selectedModel: () => {
      const current = input.model?.current()
      if (!current) return
      return { providerID: current.provider.id, modelID: current.id }
    },
    models: () =>
      providers.connected().flatMap((provider) =>
        Object.values(provider.models).map((model) => ({ providerID: provider.id, modelID: model.id })),
      ),
    visible: models.visible,
    loadModelCenterCapabilities: runtime.host.modelCenter.capabilities,
  })
}

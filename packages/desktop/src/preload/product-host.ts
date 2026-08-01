import type {
  DesktopProductHostAPI,
  ProductCredentialCapabilities,
  ProductSidecarStatus,
} from "../product/host"
import type { ProductModelCenterAPI } from "@opencode-ai/app/product/model-center"

export type ProductHostPreloadTransport = {
  readonly getSidecarStatus: () => Promise<ProductSidecarStatus>
  readonly subscribeSidecar: () => Promise<void>
  readonly unsubscribeSidecar: () => Promise<void>
  readonly restartSidecar: () => Promise<ProductSidecarStatus>
  readonly getCredentialCapabilities: () => Promise<ProductCredentialCapabilities>
  readonly modelCenterCapabilities: ProductModelCenterAPI["capabilities"]
  readonly modelCenterList: ProductModelCenterAPI["list"]
  readonly modelCenterSave: ProductModelCenterAPI["save"]
  readonly modelCenterRemove: ProductModelCenterAPI["remove"]
  readonly modelCenterDiscover: ProductModelCenterAPI["discover"]
  readonly modelCenterTest: ProductModelCenterAPI["test"]
  readonly modelCenterDetectLocal: ProductModelCenterAPI["detectLocal"]
  readonly modelCenterSelectDefault: ProductModelCenterAPI["selectDefault"]
  readonly modelCenterReloadCredentials: ProductModelCenterAPI["reloadCredentials"]
  readonly listenSidecar: (listener: (status: ProductSidecarStatus) => void) => () => void
}

export function createProductHostPreloadAPI(transport: ProductHostPreloadTransport): DesktopProductHostAPI {
  const callbacks = new Set<(status: ProductSidecarStatus) => void>()
  let status: ProductSidecarStatus | undefined
  let subscription: Promise<void> | undefined
  let stopListening: (() => void) | undefined
  let teardown = Promise.resolve()

  const notify = (callback: (status: ProductSidecarStatus) => void, next: ProductSidecarStatus) => {
    try {
      callback(next)
    } catch {}
  }

  const publish = (next: ProductSidecarStatus) => {
    status = next
    callbacks.forEach((callback) => notify(callback, next))
  }

  const ensureSubscription = () => {
    if (subscription) return subscription
    stopListening = transport.listenSidecar(publish)
    const pending = teardown.then(() => transport.subscribeSidecar())
    subscription = pending
    void pending.catch(() => {
      if (subscription !== pending) return
      subscription = undefined
      status = undefined
      callbacks.clear()
      stopListening?.()
      stopListening = undefined
    })
    return pending
  }

  const unsubscribe = (callback: (status: ProductSidecarStatus) => void) => {
    if (!callbacks.delete(callback) || callbacks.size > 0) return
    stopListening?.()
    stopListening = undefined
    subscription = undefined
    status = undefined
    teardown = teardown.then(() => transport.unsubscribeSidecar()).catch(() => undefined)
  }

  return {
    sidecar: {
      getStatus: transport.getSidecarStatus,
      async subscribe(callback) {
        const subscriber = (next: ProductSidecarStatus) => callback(next)
        callbacks.add(subscriber)
        if (status) notify(subscriber, status)
        try {
          await ensureSubscription()
        } catch (error) {
          callbacks.delete(subscriber)
          throw error
        }
        return () => unsubscribe(subscriber)
      },
      restart: transport.restartSidecar,
    },
    credentials: {
      getCapabilities: transport.getCredentialCapabilities,
    },
    modelCenter: {
      capabilities: transport.modelCenterCapabilities,
      list: transport.modelCenterList,
      save: transport.modelCenterSave,
      remove: transport.modelCenterRemove,
      discover: transport.modelCenterDiscover,
      test: transport.modelCenterTest,
      detectLocal: transport.modelCenterDetectLocal,
      selectDefault: transport.modelCenterSelectDefault,
      reloadCredentials: transport.modelCenterReloadCredentials,
    },
  }
}

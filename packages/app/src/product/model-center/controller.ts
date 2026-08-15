import { normalizeProductError } from "../errors"
import type {
  ProductDefaultModelInput,
  ProductModelCenterAPI,
  ProductProviderProfileInput,
} from "./contracts"

type ProductModelCenterControllerOptions = {
  readonly modelCenter: ProductModelCenterAPI
  readonly refreshRuntime: () => Promise<unknown>
}

export function createModelCenterController(options: ProductModelCenterControllerOptions) {
  const safe = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation()
    } catch (error) {
      throw safeError(error)
    }
  }

  return Object.freeze({
    capabilities: () => safe(() => options.modelCenter.capabilities()),
    list: () => safe(() => options.modelCenter.list()),
    discover: (input: Parameters<ProductModelCenterAPI["discover"]>[0]) =>
      safe(() => options.modelCenter.discover(input)),
    test: (input: Parameters<ProductModelCenterAPI["test"]>[0]) => safe(() => options.modelCenter.test(input)),
    detectLocal: () => safe(() => options.modelCenter.detectLocal()),
    async save(input: ProductProviderProfileInput) {
      const profile = await safe(() => options.modelCenter.save(input))
      await safe(() => options.modelCenter.reloadCredentials())
      await safe(() => options.refreshRuntime())
      return profile
    },
    async remove(profileID: string) {
      await safe(() => options.modelCenter.remove(profileID))
      await safe(() => options.modelCenter.reloadCredentials())
      await safe(() => options.refreshRuntime())
    },
    async selectDefault(input: ProductDefaultModelInput) {
      const profile = await safe(() => options.modelCenter.selectDefault(input))
      await safe(() => options.refreshRuntime())
      return profile
    },
  })
}

function safeError(error: unknown) {
  const normalized = normalizeProductError(error)
  return new Error(`${normalized.message} ${normalized.action}`)
}

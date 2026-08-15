import { normalizeProductError } from "../errors"
import {
  sanitizeProviderProfile,
  type ProductDefaultModelInput,
  type ProductModelCenterAPI,
  type ProductProviderProfile,
  type ProductProviderProfileInput,
} from "./contracts"

export const COMMITTED_PRODUCT_PROFILE_ERROR = "COMMITTED_PRODUCT_PROFILE_ERROR"

export class CommittedProductProfileError extends Error {
  readonly _tag = COMMITTED_PRODUCT_PROFILE_ERROR
  readonly profile: ProductProviderProfile

  private constructor(profile: ProductProviderProfile, message: string) {
    super(message)
    this.name = "CommittedProductProfileError"
    this.profile = sanitizeProviderProfile(profile)
    Object.freeze(this)
  }

  static from(profile: ProductProviderProfile, error: unknown) {
    return new CommittedProductProfileError(profile, safeMessage(error))
  }
}

export function isCommittedProductProfileError(error: unknown): error is CommittedProductProfileError {
  return error instanceof CommittedProductProfileError && error._tag === COMMITTED_PRODUCT_PROFILE_ERROR
}

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
      try {
        await options.modelCenter.reloadCredentials()
        await options.refreshRuntime()
      } catch (error) {
        throw CommittedProductProfileError.from(profile, error)
      }
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
  return new Error(safeMessage(error))
}

function safeMessage(error: unknown) {
  const normalized = normalizeProductError(error)
  return `${normalized.message} ${normalized.action}`
}

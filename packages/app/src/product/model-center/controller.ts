import { normalizeProductError } from "../errors"
import {
  defaultModelPatch,
  disableProviderPatch,
  enableProviderPatch,
  type ProductOpenCodeProviderConfig,
} from "./config"
import type {
  ProductDefaultModelInput,
  ProductModelCenterAPI,
  ProductProviderProfile,
  ProductProviderProfileInput,
} from "./contracts"

export type ProductModelCenterConfigPatch =
  | {
      readonly provider: Readonly<Record<string, ProductOpenCodeProviderConfig>>
      readonly disabled_providers: readonly string[]
    }
  | { readonly disabled_providers: readonly string[] }
  | { readonly model: string }

type ProductModelCenterControllerOptions = {
  readonly modelCenter: ProductModelCenterAPI
  readonly disabledProviders: () => readonly string[]
  readonly currentModel: () => string | undefined
  readonly updateConfig: (patch: ProductModelCenterConfigPatch) => Promise<void>
  readonly refreshProviders: () => Promise<unknown>
}

export function createModelCenterController(options: ProductModelCenterControllerOptions) {
  let observedModel = options.currentModel()
  let configuredModel = observedModel
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
      const before = input.id
        ? (await safe(() => options.modelCenter.list())).find((profile) => profile.id === input.id)
        : undefined
      const profile = await safe(() => options.modelCenter.save(input))
      try {
        await options.updateConfig(enableProviderPatch(profile, options.disabledProviders()))
      } catch (error) {
        await compensateSave(options.modelCenter, profile, before)
        throw safeError(error)
      }
      await safe(() => options.modelCenter.reloadCredentials())
      await safe(() => options.refreshProviders())
      return profile
    },
    async remove(profileID: string) {
      const profile = (await safe(() => options.modelCenter.list())).find((item) => item.id === profileID)
      if (!profile) throw new Error("The model profile does not exist.")
      const disabled = options.disabledProviders()
      await safe(() => options.updateConfig(disableProviderPatch(profile.providerID, disabled)))
      try {
        await options.modelCenter.remove(profileID)
      } catch (error) {
        await options.updateConfig(enableProviderPatch(profile, disabled)).catch(() => undefined)
        throw safeError(error)
      }
      await safe(() => options.modelCenter.reloadCredentials())
      await safe(() => options.refreshProviders())
    },
    async selectDefault(input: ProductDefaultModelInput) {
      const profile = (await safe(() => options.modelCenter.list())).find((item) => item.id === input.profileID)
      if (!profile) throw new Error("The model profile does not exist.")
      const patch = defaultModelPatch(profile, input.modelID)
      const observed = options.currentModel()
      if (observed !== observedModel) {
        observedModel = observed
        configuredModel = observed
      }
      const previous = configuredModel
      await safe(() => options.updateConfig(patch))
      configuredModel = patch.model
      try {
        return await options.modelCenter.selectDefault(input)
      } catch (error) {
        if (previous !== patch.model) {
          try {
            await options.updateConfig({ model: previous ?? "" })
            configuredModel = previous
          } catch (rollbackError) {
            throw safeError(rollbackError)
          }
        }
        throw safeError(error)
      }
    },
  })
}

async function compensateSave(
  modelCenter: ProductModelCenterAPI,
  saved: ProductProviderProfile,
  previous?: ProductProviderProfile,
) {
  try {
    if (!previous) {
      await modelCenter.remove(saved.id)
      return
    }
    await modelCenter.save(profileInput(previous))
  } catch {}
}

function profileInput(profile: ProductProviderProfile): ProductProviderProfileInput {
  return Object.freeze({
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    baseURL: profile.baseURL,
    headers: profile.headers,
    models: profile.models,
    ...(profile.defaultModelID ? { defaultModelID: profile.defaultModelID } : {}),
    settings: profile.settings,
  })
}

function safeError(error: unknown) {
  const normalized = normalizeProductError(error)
  return new Error(`${normalized.message} ${normalized.action}`)
}

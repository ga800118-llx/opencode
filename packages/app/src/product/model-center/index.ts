import type { ProductModelCenterAPI, ProductModelCenterCapabilities } from "./contracts"

export * from "./contracts"
export * from "./config"

const unavailableCapabilities = Object.freeze({
  available: false,
  credentialBackend: "unsupported",
  credentialOperations: Object.freeze({ read: false, write: false, delete: false }),
  localDetection: false,
}) satisfies ProductModelCenterCapabilities

const unavailable = () => Promise.reject(new Error("The visual model center requires the desktop host."))

export function createUnavailableProductModelCenter(): ProductModelCenterAPI {
  return Object.freeze({
    capabilities: () => Promise.resolve(unavailableCapabilities),
    list: () => Promise.resolve([]),
    save: unavailable,
    remove: unavailable,
    discover: unavailable,
    test: unavailable,
    detectLocal: () => Promise.resolve([]),
    selectDefault: unavailable,
    reloadCredentials: unavailable,
  })
}

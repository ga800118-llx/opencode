import {
  profileCredentialEnvironment,
  profileCredentialProxyBaseURLEnvironment,
  profileSensitiveHeaderEnvironment,
  type ProductProviderProfile,
} from "@opencode-ai/app/product/model-center"
import type { ProductCredentialService } from "./credentials"

export type ModelCredentialEnvironmentWarning = {
  readonly profileID: string
  readonly kind: "credential-proxy" | "missing-credential" | "credential-read" | "missing-api-key" | "missing-header"
}

type ModelCredentialEnvironmentInput = {
  readonly profiles: readonly ProductProviderProfile[]
  readonly credentials: ProductCredentialService
  readonly warn?: (warning: ModelCredentialEnvironmentWarning) => void
  readonly credentialProxy?: (
    profile: ProductProviderProfile,
  ) => { readonly credential: string; readonly baseURL: string } | undefined
}

export function createModelCredentialEnvironment(input: ModelCredentialEnvironmentInput) {
  const environment: Record<string, string> = {}
  for (const profile of input.profiles) {
    const requiresCredentials =
      profile.hasApiKey || profile.headers.some((header) => header.sensitive && header.hasValue)
    const proxy = input.credentialProxy?.(profile)
    if (proxy) {
      environment[profileCredentialEnvironment(profile.id)] = proxy.credential
      environment[profileCredentialProxyBaseURLEnvironment(profile.id)] = proxy.baseURL
      continue
    }
    if (input.credentialProxy && requiresCredentials) {
      input.warn?.(Object.freeze({ profileID: profile.id, kind: "credential-proxy" }))
      continue
    }
    const reference = profile.credentialRef
    if (!reference || !input.credentials.has(reference)) {
      if (requiresCredentials) {
        input.warn?.(Object.freeze({ profileID: profile.id, kind: "missing-credential" }))
      }
      continue
    }

    let envelope
    try {
      envelope = input.credentials.read(reference)
    } catch {
      input.warn?.(Object.freeze({ profileID: profile.id, kind: "credential-read" }))
      continue
    }
    if (!envelope) {
      input.warn?.(Object.freeze({ profileID: profile.id, kind: "missing-credential" }))
      continue
    }

    if (profile.hasApiKey) {
      if (envelope.apiKey) environment[profileCredentialEnvironment(profile.id)] = envelope.apiKey
      else input.warn?.(Object.freeze({ profileID: profile.id, kind: "missing-api-key" }))
    }
    const secretHeaders = new Map(
      Object.entries(envelope.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    )
    for (const header of profile.headers) {
      if (!header.sensitive || !header.hasValue) continue
      const value = secretHeaders.get(header.name.toLowerCase())
      if (value) {
        environment[profileSensitiveHeaderEnvironment(profile.id, header.name)] = value
        continue
      }
      input.warn?.(Object.freeze({ profileID: profile.id, kind: "missing-header" }))
    }
  }
  return Object.freeze(environment)
}

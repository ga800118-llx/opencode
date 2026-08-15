import {
  normalizeProviderProfileInput,
  type ProductCredentialEnvelopeInput,
  type ProductModelCenterAPI,
  type ProductProviderHeader,
  type ProductProviderProfile,
  type ProductProviderProfileInput,
  type ProductProviderProbeInput,
} from "@opencode-ai/app/product/model-center"
import type { ProductCredentialEnvelope, ProductCredentialService } from "./credentials"
import type { LocalModelDetector } from "./local-detection"
import { MODEL_PROBE_TIMEOUT_MS, type ModelProbe, type ModelProbeTarget } from "./probe"
import type { ProfileRepository } from "./profiles"

type ModelCenterServiceOptions = {
  readonly profiles: ProfileRepository
  readonly credentials: ProductCredentialService
  readonly probe: ModelProbe
  readonly detector: LocalModelDetector
  readonly reloadCredentials: () => Promise<void>
  readonly presentProfile?: (profile: ProductProviderProfile) => ProductProviderProfile
}

export function createModelCenterService(options: ModelCenterServiceOptions): ProductModelCenterAPI {
  const present = options.presentProfile ?? ((profile: ProductProviderProfile) => profile)
  return Object.freeze({
    async capabilities() {
      const credentials = options.credentials.capabilities()
      return Object.freeze({
        available: true,
        credentialBackend: credentials.backend,
        credentialOperations: credentials.operations,
        localDetection: true,
      })
    },
    async list() {
      return Object.freeze(options.profiles.list().map(present))
    },
    async save(input) {
      const normalized = normalizeProviderProfileInput(input)
      const existing = normalized.id ? options.profiles.get(normalized.id) : undefined
      if (normalized.id && !existing) throw new Error("The model profile does not exist.")

      const provisional =
        existing ?? options.profiles.save(withoutCredentials(normalized), { hasApiKey: false, sensitiveHeaders: [] })
      const created = !existing
      const reference = provisional.credentialRef ?? `model-profile:${provisional.id}`
      let previous: ProductCredentialEnvelope | undefined
      try {
        previous = options.credentials.has(reference) ? options.credentials.read(reference) : undefined
      } catch {
        if (created) options.profiles.remove(provisional.id)
        throw new Error("The saved model credentials are unavailable.")
      }
      const next = mergeCredentialEnvelope(previous, normalized.credentials, normalized.headers)

      try {
        writeCredentialEnvelope(options.credentials, reference, next)
      } catch {
        if (created) options.profiles.remove(provisional.id)
        throw new Error("The model credentials could not be saved.")
      }

      try {
        return present(options.profiles.save(
          { ...withoutCredentials(normalized), id: provisional.id },
          {
            hasApiKey: Boolean(next.apiKey),
            sensitiveHeaders: Object.keys(next.headers ?? {}),
            preserveTest: credentialSignature(previous) === credentialSignature(next),
          },
        ))
      } catch {
        restoreCredentialEnvelope(options.credentials, reference, previous)
        if (created) options.profiles.remove(provisional.id)
        throw new Error("The model profile could not be saved.")
      }
    },
    async remove(profileID) {
      const profile = options.profiles.get(profileID)
      if (!profile) return
      if (profile.credentialRef) {
        try {
          options.credentials.delete(profile.credentialRef)
        } catch {
          throw new Error("The model credentials could not be deleted.")
        }
      }
      options.profiles.remove(profileID)
    },
    async discover(input) {
      return options.probe.discover(resolveProbeTarget(input, options))
    },
    async test(input) {
      const report = await options.probe.test({
        target: resolveProbeTarget(input, options),
        modelID: input.modelID,
      })
      if (input.profileID) {
        options.profiles.recordTest(input.profileID, report)
      } else if (input.draft?.id) {
        const profile = options.profiles.get(input.draft.id)
        const draft = normalizeProviderProfileInput(input.draft)
        if (profile && probeDraftMatchesProfile(profile, draft)) options.profiles.recordTest(profile.id, report)
      }
      return report
    },
    async detectLocal() {
      return options.detector.detect()
    },
    async selectDefault(input) {
      const profile = options.profiles.get(input.profileID)
      if (!profile) throw new Error("The model profile does not exist.")
      const selected = options.profiles.selectDefault(input)
      await options.reloadCredentials()
      return present(selected)
    },
    async reloadCredentials() {
      await options.reloadCredentials()
    },
  })
}

function resolveProbeTarget(input: ProductProviderProbeInput, options: ModelCenterServiceOptions): ModelProbeTarget {
  if (input.profileID && input.draft) throw new Error("Choose either a saved profile or a draft profile.")
  if (input.profileID) {
    const profile = options.profiles.get(input.profileID)
    if (!profile) throw new Error("The model profile does not exist.")
    const envelope = readProfileCredentials(profile, options.credentials)
    return targetFromProfile(profile, envelope)
  }
  if (!input.draft) throw new Error("A model profile is required.")
  const draft = normalizeProviderProfileInput(input.draft)
  const existing = draft.id ? options.profiles.get(draft.id) : undefined
  if (draft.id && !existing) throw new Error("The model profile does not exist.")
  const current = existing ? readProfileCredentials(existing, options.credentials) : undefined
  const envelope = mergeCredentialEnvelope(current, draft.credentials, draft.headers)
  return targetFromDraft(draft, envelope)
}

function readProfileCredentials(profile: ProductProviderProfile, credentials: ProductCredentialService) {
  if (!profile.credentialRef || !credentials.has(profile.credentialRef)) return undefined
  try {
    return credentials.read(profile.credentialRef)
  } catch {
    throw new Error("The saved model credentials are unavailable.")
  }
}

function targetFromProfile(profile: ProductProviderProfile, envelope?: ProductCredentialEnvelope): ModelProbeTarget {
  return Object.freeze({
    kind: profile.kind,
    baseURL: profile.baseURL,
    ...(envelope?.apiKey ? { apiKey: envelope.apiKey } : {}),
    headers: Object.freeze(resolveHeaders(profile.headers, envelope)),
    timeoutMs: MODEL_PROBE_TIMEOUT_MS,
  })
}

function targetFromDraft(
  profile: ProductProviderProfileInput,
  envelope: ProductCredentialEnvelope,
): ModelProbeTarget {
  return Object.freeze({
    kind: profile.kind,
    baseURL: profile.baseURL,
    ...(envelope.apiKey ? { apiKey: envelope.apiKey } : {}),
    headers: Object.freeze(resolveHeaders(profile.headers, envelope)),
    timeoutMs: MODEL_PROBE_TIMEOUT_MS,
  })
}

function resolveHeaders(headers: readonly ProductProviderHeader[], envelope?: ProductCredentialEnvelope) {
  const secrets = new Map(Object.entries(envelope?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  return Object.fromEntries(
    headers.flatMap((header) => {
      if (!header.sensitive) return header.value ? [[header.name, header.value]] : []
      const value = secrets.get(header.name.toLowerCase())
      return value ? [[header.name, value]] : []
    }),
  )
}

function mergeCredentialEnvelope(
  current: ProductCredentialEnvelope | undefined,
  patch: ProductCredentialEnvelopeInput | undefined,
  headers: readonly ProductProviderHeader[],
): ProductCredentialEnvelope {
  const apiKey = patch?.apiKey === undefined ? current?.apiKey : patch.apiKey === null ? undefined : patch.apiKey
  const allowed = headers.filter((header) => header.sensitive).map((header) => header.name)
  const previous = new Map(Object.entries(current?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  const changes = new Map(
    Object.entries(patch?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value] as const),
  )
  const nextHeaders = Object.fromEntries(
    allowed.flatMap((name) => {
      const change = changes.get(name.toLowerCase())
      const value = change === undefined ? previous.get(name.toLowerCase()) : change === null ? undefined : change
      return value ? [[name, value]] : []
    }),
  )
  return Object.freeze({
    ...(apiKey ? { apiKey } : {}),
    ...(Object.keys(nextHeaders).length ? { headers: Object.freeze(nextHeaders) } : {}),
  })
}

function credentialSignature(envelope: ProductCredentialEnvelope | undefined) {
  return JSON.stringify({
    apiKey: envelope?.apiKey ?? "",
    headers: Object.entries(envelope?.headers ?? {})
      .map(([name, value]) => [name.toLowerCase(), value])
      .sort(([left], [right]) => left.localeCompare(right)),
  })
}

function writeCredentialEnvelope(
  credentials: ProductCredentialService,
  reference: string,
  envelope: ProductCredentialEnvelope,
) {
  if (envelope.apiKey || Object.keys(envelope.headers ?? {}).length) {
    credentials.write(reference, envelope)
    return
  }
  if (credentials.has(reference)) credentials.delete(reference)
}

function restoreCredentialEnvelope(
  credentials: ProductCredentialService,
  reference: string,
  previous: ProductCredentialEnvelope | undefined,
) {
  try {
    if (previous) credentials.write(reference, previous)
    else if (credentials.has(reference)) credentials.delete(reference)
  } catch {}
}

function withoutCredentials(input: ProductProviderProfileInput): ProductProviderProfileInput {
  return Object.freeze({
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    kind: input.kind,
    baseURL: input.baseURL,
    headers: input.headers,
    models: input.models,
    ...(input.defaultModelID ? { defaultModelID: input.defaultModelID } : {}),
    settings: input.settings,
  })
}

function probeDraftMatchesProfile(profile: ProductProviderProfile, draft: ProductProviderProfileInput) {
  return (
    profile.name === draft.name &&
    profile.kind === draft.kind &&
    profile.baseURL === draft.baseURL &&
    JSON.stringify(profile.headers) === JSON.stringify(draft.headers) &&
    JSON.stringify(profile.models) === JSON.stringify(draft.models) &&
    JSON.stringify(profile.settings) === JSON.stringify(draft.settings)
  )
}

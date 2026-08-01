import {
  normalizeProviderProfileInput,
  profileProviderID,
  sanitizeProviderProfile,
  type ProductCapabilityReport,
  type ProductDefaultModelInput,
  type ProductProviderProfile,
  type ProductProviderProfileInput,
} from "@opencode-ai/app/product/model-center"

export type ProfileStore = {
  readonly get: (key: string) => unknown
  readonly set: (key: string, value: unknown) => void
}

export type ProfileSecretState = {
  readonly hasApiKey: boolean
  readonly sensitiveHeaders: readonly string[]
}

export type ProfileRepository = {
  readonly list: () => readonly ProductProviderProfile[]
  readonly get: (profileID: string) => ProductProviderProfile | undefined
  readonly save: (input: ProductProviderProfileInput, secrets?: ProfileSecretState) => ProductProviderProfile
  readonly remove: (profileID: string) => ProductProviderProfile | undefined
  readonly recordTest: (profileID: string, report: ProductCapabilityReport) => ProductProviderProfile
  readonly selectDefault: (input: ProductDefaultModelInput) => ProductProviderProfile
  readonly defaultSelection: () => ProductDefaultModelInput | undefined
}

type ProfileRepositoryOptions = {
  readonly store: ProfileStore
  readonly now?: () => number
  readonly randomUUID?: () => string
}

type StoredProfileState = {
  readonly version: 1
  readonly profiles: readonly ProductProviderProfile[]
  readonly default?: ProductDefaultModelInput
}

const STORE_KEY = "state"

export function createProfileRepository(options: ProfileRepositoryOptions): ProfileRepository {
  const now = options.now ?? Date.now
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID())
  let state = loadState(options.store.get(STORE_KEY))
  if (state.changed) options.store.set(STORE_KEY, state.value)

  const persist = (next: StoredProfileState) => {
    state = { value: freezeState(next), changed: false }
    options.store.set(STORE_KEY, state.value)
  }

  const find = (profileID: string) => state.value.profiles.find((profile) => profile.id === profileID)

  const replace = (profile: ProductProviderProfile, selected = state.value.default) => {
    const profiles = [profile, ...state.value.profiles.filter((item) => item.id !== profile.id)].sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    )
    const validDefault =
      selected?.profileID === profile.id && !profile.models.some((model) => model.id === selected.modelID)
        ? undefined
        : selected
    persist({ version: 1, profiles, ...(validDefault ? { default: validDefault } : {}) })
    return profile
  }

  return Object.freeze({
    list: () => Object.freeze([...state.value.profiles]),
    get: find,
    save(input, secrets) {
      const normalized = normalizeProviderProfileInput(input)
      const existing = normalized.id ? find(normalized.id) : undefined
      if (normalized.id && !existing) throw new Error("The model profile does not exist.")
      const id = existing?.id ?? randomUUID()
      const changedAt = now()
      const previousSensitive = new Set(
        existing?.headers.filter((header) => header.sensitive && header.hasValue).map((header) => header.name.toLowerCase()),
      )
      const nextSensitive = new Set(secrets?.sensitiveHeaders.map((name) => name.toLowerCase()) ?? previousSensitive)
      const headers = normalized.headers.map((header) => ({
        name: header.name,
        ...(header.sensitive ? {} : header.value ? { value: header.value } : {}),
        sensitive: header.sensitive,
        hasValue: header.sensitive ? nextSensitive.has(header.name.toLowerCase()) : Boolean(header.value),
      }))
      const hasApiKey = secrets?.hasApiKey ?? existing?.hasApiKey ?? false
      const hasSensitiveHeader = headers.some((header) => header.sensitive && header.hasValue)
      const preserveTest = existing?.test && profileSignature(existing) === inputSignature(normalized)
      const profile = sanitizeProviderProfile({
        id,
        providerID: existing?.providerID ?? profileProviderID(id),
        name: normalized.name,
        kind: normalized.kind,
        baseURL: normalized.baseURL,
        ...((hasApiKey || hasSensitiveHeader) && {
          credentialRef: existing?.credentialRef ?? `model-profile:${id}`,
        }),
        hasApiKey,
        headers,
        models: normalized.models,
        ...(normalized.defaultModelID ? { defaultModelID: normalized.defaultModelID } : {}),
        settings: normalized.settings,
        ...(preserveTest ? { test: preserveTest } : {}),
        createdAt: existing?.createdAt ?? changedAt,
        updatedAt: changedAt,
      })
      return replace(profile)
    },
    remove(profileID) {
      const profile = find(profileID)
      if (!profile) return
      const profiles = state.value.profiles.filter((item) => item.id !== profileID)
      const selected = state.value.default?.profileID === profileID ? undefined : state.value.default
      persist({ version: 1, profiles, ...(selected ? { default: selected } : {}) })
      return profile
    },
    recordTest(profileID, report) {
      const existing = find(profileID)
      if (!existing) throw new Error("The model profile does not exist.")
      if (!existing.models.some((model) => model.id === report.modelID)) {
        throw new Error("The tested model does not belong to this profile.")
      }
      const profile = sanitizeProviderProfile({ ...existing, test: report, updatedAt: now() })
      return replace(profile)
    },
    selectDefault(input) {
      const existing = find(input.profileID)
      if (!existing) throw new Error("The model profile does not exist.")
      if (!existing.models.some((model) => model.id === input.modelID)) {
        throw new Error("The selected model does not belong to this profile.")
      }
      const profile = sanitizeProviderProfile({ ...existing, defaultModelID: input.modelID, updatedAt: now() })
      return replace(profile, Object.freeze({ profileID: profile.id, modelID: input.modelID }))
    },
    defaultSelection: () =>
      state.value.default ? Object.freeze({ ...state.value.default }) : undefined,
  })
}

function loadState(input: unknown): { value: StoredProfileState; changed: boolean } {
  if (!isRecord(input)) return { value: freezeState({ version: 1, profiles: [] }), changed: false }
  const profiles = Array.isArray(input.profiles)
    ? input.profiles.flatMap((profile) => {
        try {
          return [sanitizeProviderProfile(profile)]
        } catch {
          return []
        }
      })
    : []
  profiles.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))

  const requestedDefault =
    input.version === 1 && isRecord(input.default)
      ? { profileID: input.default.profileID, modelID: input.default.modelID }
      : typeof input.defaultProfileID === "string"
        ? {
            profileID: input.defaultProfileID,
            modelID: profiles.find((profile) => profile.id === input.defaultProfileID)?.defaultModelID,
          }
        : undefined
  const selectedProfile =
    typeof requestedDefault?.profileID === "string"
      ? profiles.find((profile) => profile.id === requestedDefault.profileID)
      : undefined
  const selected =
    selectedProfile &&
    typeof requestedDefault?.modelID === "string" &&
    selectedProfile.models.some((model) => model.id === requestedDefault.modelID)
      ? Object.freeze({ profileID: selectedProfile.id, modelID: requestedDefault.modelID })
      : undefined
  const value = freezeState({ version: 1, profiles, ...(selected ? { default: selected } : {}) })
  const changed = input.version !== 1 || JSON.stringify(input) !== JSON.stringify(value)
  return { value, changed }
}

function freezeState(input: StoredProfileState): StoredProfileState {
  return Object.freeze({
    version: 1,
    profiles: Object.freeze([...input.profiles]),
    ...(input.default ? { default: Object.freeze({ ...input.default }) } : {}),
  })
}

function profileSignature(profile: ProductProviderProfile) {
  return JSON.stringify({
    name: profile.name,
    kind: profile.kind,
    baseURL: profile.baseURL,
    headers: profile.headers,
    models: profile.models,
    settings: profile.settings,
  })
}

function inputSignature(input: ProductProviderProfileInput) {
  return JSON.stringify({
    name: input.name,
    kind: input.kind,
    baseURL: input.baseURL,
    headers: input.headers,
    models: input.models,
    settings: input.settings,
  })
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

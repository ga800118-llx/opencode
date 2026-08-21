import {
  isCommittedProductProfileError,
  normalizeProviderProfileInput,
  type ProductCapabilityReport,
  type ProductLocalProviderCandidate,
  type ProductModelDiagnostic,
  type ProductModelCenterAPI,
  type ProductProviderHeader,
  type ProductProviderKind,
  type ProductProviderModel,
  type ProductProviderProfile,
  type ProductProviderProfileInput,
} from "@/product/model-center"
import { createStore, produce } from "solid-js/store"

export type ModelProfileOperations = Pick<
  ProductModelCenterAPI,
  "discover" | "test" | "detectLocal" | "save" | "remove" | "selectDefault"
>

export type ModelDiscoveryFeedback =
  | { readonly type: "invalid-endpoint" }
  | { readonly type: "success"; readonly count: number }
  | { readonly type: "diagnostic"; readonly diagnostic: ProductModelDiagnostic }
  | { readonly type: "unexpected" }

type HeaderDraft = {
  name: string
  value: string
  sensitive: boolean
  hasValue: boolean
}

type FormState = {
  mode: "create" | "edit"
  profileID?: string
  kind: ProductProviderKind
  name: string
  baseURL: string
  apiKey: ""
  apiKeyPresent: boolean
  credentialRecoveryRequired: boolean
  credentialInputRevision: number
  headers: HeaderDraft[]
  models: ProductProviderModel[]
  modelQuery: string
  selectedModelID?: string
  settings: {
    contextLimit: number
    outputLimit: number
    proxyURL: string
    allowInsecureTls: false
  }
  report?: ProductCapabilityReport
  localCandidates: ProductLocalProviderCandidate[]
  discovering: boolean
  testing: boolean
  detecting: boolean
  selectingDefault: boolean
  saving: boolean
  deleting: boolean
  deleteConfirmation: boolean
  error?: string
  diagnostic?: ProductModelDiagnostic
  discoveryFeedback?: ModelDiscoveryFeedback
}

const KIND_DEFAULTS: Record<ProductProviderKind, { name: string; baseURL: string }> = {
  "openai-compatible": { name: "Private endpoint", baseURL: "https://api.example.com/v1" },
  ollama: { name: "Ollama", baseURL: "http://127.0.0.1:11434" },
  "lm-studio": { name: "LM Studio", baseURL: "http://127.0.0.1:1234/v1" },
  "custom-local": { name: "Local endpoint", baseURL: "http://127.0.0.1:8000/v1" },
}

const DEFAULT_SETTINGS = {
  contextLimit: 128_000,
  outputLimit: 16_000,
  proxyURL: "",
  allowInsecureTls: false as const,
}

const INVALID_ENDPOINT_MESSAGE = "A valid HTTP or HTTPS endpoint is required."

function isCompleteEndpoint(value: string) {
  const input = value.trim()
  if (!/^https?:\/\/[^/?#]+/i.test(input) || !URL.canParse(input)) return false
  const endpoint = new URL(input)
  return (
    (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
    Boolean(endpoint.hostname) &&
    !endpoint.username &&
    !endpoint.password
  )
}

function requiresCredentialRecovery(profile?: ProductProviderProfile) {
  return Boolean(
    profile?.credentialRef &&
      !profile.hasApiKey &&
      !profile.headers.some((header) => header.sensitive && header.hasValue),
  )
}

export function createModelProfileFormController(options: {
  readonly operations: ModelProfileOperations
  readonly profile?: ProductProviderProfile
}) {
  const initial = options.profile
  const secretHeaders = new Map<number, string>()
  let apiKey = ""
  let discoveryGeneration = 0
  let testGeneration = 0
  let detectionGeneration = 0
  let savePromise: Promise<ProductProviderProfile> | undefined
  let deletePromise: Promise<void> | undefined
  let defaultPromise: Promise<ProductProviderProfile> | undefined
  let persistedApiKeyPresent = initial?.hasApiKey ?? false
  let credentialRecoveryBaseline = requiresCredentialRecovery(initial)
  const persistedModelIDs = new Set(initial?.models.map((model) => model.id) ?? [])
  const persistedSecretHeaders = new Map<number, { name: string; hasValue: boolean }>()
  initial?.headers.forEach((header, index) => {
    if (header.sensitive) persistedSecretHeaders.set(index, { name: header.name, hasValue: header.hasValue })
  })

  const [state, setState] = createStore<FormState>({
    mode: initial ? "edit" : "create",
    ...(initial ? { profileID: initial.id } : {}),
    kind: initial?.kind ?? "openai-compatible",
    name: initial?.name ?? KIND_DEFAULTS["openai-compatible"].name,
    baseURL: initial?.baseURL ?? KIND_DEFAULTS["openai-compatible"].baseURL,
    apiKey: "",
    apiKeyPresent: initial?.hasApiKey ?? false,
    credentialRecoveryRequired: credentialRecoveryBaseline,
    credentialInputRevision: 0,
    headers:
      initial?.headers.map((header) => ({
        name: header.name,
        value: header.sensitive ? "" : (header.value ?? ""),
        sensitive: header.sensitive,
        hasValue: header.hasValue,
      })) ?? [],
    models: initial?.models.map((model) => ({ ...model })) ?? [],
    modelQuery: "",
    ...(initial?.defaultModelID ? { selectedModelID: initial.defaultModelID } : {}),
    settings: {
      contextLimit: initial?.settings.contextLimit ?? DEFAULT_SETTINGS.contextLimit,
      outputLimit: initial?.settings.outputLimit ?? DEFAULT_SETTINGS.outputLimit,
      proxyURL: "",
      allowInsecureTls: false,
    },
    ...(initial?.test && initial.test.modelID === initial.defaultModelID ? { report: initial.test } : {}),
    localCandidates: [],
    discovering: false,
    testing: false,
    detecting: false,
    selectingDefault: false,
    saving: false,
    deleting: false,
    deleteConfirmation: false,
  })

  const clearLegacyFeedback = () => {
    setState("error", undefined)
    setState("diagnostic", undefined)
  }

  const clearDiscoveryFeedback = () => {
    setState("discoveryFeedback", undefined)
  }

  const updateCredentialRecovery = () => {
    const hasReplacement =
      apiKey.length > 0 ||
      state.headers.some(
        (header, index) => header.sensitive && header.name.trim().length > 0 && Boolean(secretHeaders.get(index)),
      )
    setState("credentialRecoveryRequired", credentialRecoveryBaseline && !hasReplacement)
  }

  const persistedHeaderHasValue = (index: number, name: string) => {
    const persisted = persistedSecretHeaders.get(index)
    return Boolean(persisted?.hasValue && persisted.name.trim().toLowerCase() === name.trim().toLowerCase())
  }

  const clearTransientCredentials = () => {
    apiKey = ""
    secretHeaders.clear()
    setState("credentialInputRevision", (revision) => revision + 1)
  }

  const invalidateDiscovery = () => {
    discoveryGeneration += 1
    setState("discovering", false)
    clearDiscoveryFeedback()
  }

  const invalidateTest = () => {
    testGeneration += 1
    setState("testing", false)
    setState("report", undefined)
    setState("diagnostic", undefined)
  }

  const adoptProfile = (profile: ProductProviderProfile) => {
    persistedModelIDs.clear()
    profile.models.forEach((model) => persistedModelIDs.add(model.id))
    persistedApiKeyPresent = profile.hasApiKey
    credentialRecoveryBaseline = requiresCredentialRecovery(profile)
    persistedSecretHeaders.clear()
    profile.headers.forEach((header, index) => {
      if (header.sensitive) persistedSecretHeaders.set(index, { name: header.name, hasValue: header.hasValue })
    })
    clearTransientCredentials()
    setState("profileID", profile.id)
    setState("mode", "edit")
    setState("apiKeyPresent", profile.hasApiKey)
    setState("credentialRecoveryRequired", credentialRecoveryBaseline)
    setState(
      "headers",
      profile.headers.map((header) => ({
        name: header.name,
        value: header.sensitive ? "" : (header.value ?? ""),
        sensitive: header.sensitive,
        hasValue: header.hasValue,
      })),
    )
    return profile
  }

  const input = (): ProductProviderProfileInput => {
    if (!isCompleteEndpoint(state.baseURL)) throw new Error(INVALID_ENDPOINT_MESSAGE)
    const headers: ProductProviderHeader[] = state.headers.flatMap<ProductProviderHeader>((header, index) => {
      if (!header.name.trim()) return []
      if (header.sensitive) {
        const secret = secretHeaders.get(index)
        return [
          {
            name: header.name,
            sensitive: true,
            hasValue: Boolean(secret) || persistedHeaderHasValue(index, header.name),
          },
        ]
      }
      return [
        {
          name: header.name,
          value: header.value,
          sensitive: false,
          hasValue: Boolean(header.value.trim()),
        },
      ]
    })
    const credentialHeaders = Object.fromEntries(
      state.headers.flatMap((header, index) => {
        if (!header.sensitive || !header.name.trim()) return []
        const value = secretHeaders.get(index)
        return value ? [[header.name, value]] : []
      }),
    )
    const hasCredentialPatch = apiKey.length > 0 || Object.keys(credentialHeaders).length > 0
    return normalizeProviderProfileInput({
      ...(state.profileID ? { id: state.profileID } : {}),
      name: state.name,
      kind: state.kind,
      baseURL: state.baseURL,
      headers,
      models: state.models,
      ...(state.selectedModelID ? { defaultModelID: state.selectedModelID } : {}),
      settings: {
        contextLimit: state.settings.contextLimit,
        outputLimit: state.settings.outputLimit,
        ...(state.settings.proxyURL ? { proxyURL: state.settings.proxyURL } : {}),
        allowInsecureTls: false,
      },
      ...(hasCredentialPatch
        ? {
            credentials: {
              ...(apiKey ? { apiKey } : {}),
              ...(Object.keys(credentialHeaders).length ? { headers: credentialHeaders } : {}),
            },
          }
        : {}),
    })
  }

  const controller = {
    state,
    apiKeyValue: () => {
      void state.credentialInputRevision
      return apiKey
    },
    headerValue: (index: number) => {
      void state.credentialInputRevision
      return state.headers[index]?.sensitive
        ? (secretHeaders.get(index) ?? "")
        : (state.headers[index]?.value ?? "")
    },
    setKind(kind: ProductProviderKind) {
      const defaults = KIND_DEFAULTS[kind]
      invalidateDiscovery()
      invalidateTest()
      persistedApiKeyPresent = false
      credentialRecoveryBaseline = false
      persistedSecretHeaders.clear()
      clearTransientCredentials()
      setState({
        ...state,
        kind,
        name: defaults.name,
        baseURL: defaults.baseURL,
        apiKeyPresent: false,
        credentialRecoveryRequired: false,
        headers: [],
        models: [],
        selectedModelID: undefined,
        report: undefined,
      })
      clearLegacyFeedback()
    },
    setField(field: "name" | "baseURL", value: string) {
      if (field === "baseURL") {
        invalidateDiscovery()
        invalidateTest()
      }
      setState(field, value)
      clearLegacyFeedback()
    },
    setSetting(field: "contextLimit" | "outputLimit", value: number) {
      invalidateTest()
      setState("settings", field, value)
      clearLegacyFeedback()
    },
    setProxyURL(value: string) {
      invalidateDiscovery()
      invalidateTest()
      setState("settings", "proxyURL", value)
      clearLegacyFeedback()
    },
    setApiKey(value: string) {
      invalidateDiscovery()
      invalidateTest()
      apiKey = value
      setState("apiKeyPresent", Boolean(value) || persistedApiKeyPresent)
      updateCredentialRecovery()
      clearLegacyFeedback()
    },
    addHeader(header: { name?: string; value?: string; sensitive?: boolean } = {}) {
      const index = state.headers.length
      const sensitive = header.sensitive === true
      invalidateDiscovery()
      invalidateTest()
      if (sensitive && header.value) secretHeaders.set(index, header.value)
      setState(
        "headers",
        produce((rows) => {
          rows.push({
            name: header.name ?? "",
            value: sensitive ? "" : (header.value ?? ""),
            sensitive,
            hasValue: Boolean(header.value),
          })
        }),
      )
      updateCredentialRecovery()
      clearLegacyFeedback()
    },
    setHeader(index: number, patch: Partial<Pick<HeaderDraft, "name" | "value" | "sensitive">>) {
      const current = state.headers[index]
      if (!current) return
      const sensitive = patch.sensitive ?? current.sensitive
      const nextValue = patch.value ?? controller.headerValue(index)
      const nextName = patch.name ?? current.name
      invalidateDiscovery()
      invalidateTest()
      if (sensitive && nextValue) secretHeaders.set(index, nextValue)
      else secretHeaders.delete(index)
      setState("headers", index, {
        ...current,
        ...patch,
        value: sensitive ? "" : nextValue,
        sensitive,
        hasValue: sensitive ? Boolean(nextValue) || persistedHeaderHasValue(index, nextName) : Boolean(nextValue),
      })
      updateCredentialRecovery()
      clearLegacyFeedback()
    },
    removeHeader(index: number) {
      const replacements = [...secretHeaders.entries()]
      const persisted = [...persistedSecretHeaders.entries()]
      invalidateDiscovery()
      invalidateTest()
      setState(
        "headers",
        produce((rows) => {
          rows.splice(index, 1)
        }),
      )
      secretHeaders.clear()
      replacements.forEach(([current, value]) => {
        if (current === index) return
        secretHeaders.set(current > index ? current - 1 : current, value)
      })
      persistedSecretHeaders.clear()
      persisted.forEach(([current, value]) => {
        if (current === index) return
        persistedSecretHeaders.set(current > index ? current - 1 : current, value)
      })
      updateCredentialRecovery()
      clearLegacyFeedback()
    },
    addManualModel(id: string, name = id) {
      const modelID = id.trim()
      if (!modelID || state.models.some((model) => model.id === modelID)) return
      setState(
        "models",
        produce((models) => {
          models.push({ id: modelID, name: name.trim() || modelID, source: "manual" })
        }),
      )
      if (!state.selectedModelID) setState("selectedModelID", modelID)
      clearLegacyFeedback()
    },
    removeModel(modelID: string) {
      const changesSelection = state.selectedModelID === modelID
      setState(
        "models",
        produce((models) => {
          const index = models.findIndex((model) => model.id === modelID)
          if (index >= 0) models.splice(index, 1)
        }),
      )
      if (changesSelection || state.report?.modelID === modelID) invalidateTest()
      if (changesSelection) setState("selectedModelID", state.models[0]?.id)
      clearLegacyFeedback()
    },
    selectModel(modelID: string) {
      if (!state.models.some((model) => model.id === modelID)) return
      if (state.selectedModelID !== modelID) invalidateTest()
      setState("selectedModelID", modelID)
      clearLegacyFeedback()
    },
    setModelQuery(value: string) {
      setState("modelQuery", value)
    },
    filteredModels() {
      const query = state.modelQuery.trim().toLowerCase()
      if (!query) return [...state.models]
      return state.models.filter(
        (model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
      )
    },
    applyLocalCandidate(candidate: ProductLocalProviderCandidate) {
      invalidateDiscovery()
      invalidateTest()
      detectionGeneration += 1
      persistedApiKeyPresent = false
      credentialRecoveryBaseline = false
      persistedSecretHeaders.clear()
      clearTransientCredentials()
      setState("kind", candidate.kind)
      setState("name", candidate.name)
      setState("baseURL", candidate.baseURL)
      setState("apiKeyPresent", false)
      setState("credentialRecoveryRequired", false)
      setState("headers", state.headers.filter((header) => !header.sensitive))
      setState(
        "models",
        candidate.models.map((model) => ({ ...model })),
      )
      setState("selectedModelID", candidate.models[0]?.id)
      setState("report", undefined)
      clearLegacyFeedback()
    },
    async detectLocal() {
      const generation = ++detectionGeneration
      setState("detecting", true)
      clearLegacyFeedback()
      try {
        const result = await options.operations.detectLocal()
        if (generation !== detectionGeneration) return []
        setState(
          "localCandidates",
          result.map((candidate) => ({ ...candidate })),
        )
        return result
      } catch (error) {
        if (generation !== detectionGeneration) return []
        throw recordError(error)
      } finally {
        if (generation === detectionGeneration) setState("detecting", false)
      }
    },
    async discover() {
      const generation = ++discoveryGeneration
      clearLegacyFeedback()
      clearDiscoveryFeedback()
      if (!isCompleteEndpoint(state.baseURL)) {
        setState("discovering", false)
        setState("discoveryFeedback", { type: "invalid-endpoint" })
        return
      }
      setState("discovering", true)
      const secrets = credentialValues()
      try {
        const result = await options.operations.discover({ draft: input() })
        if (generation !== discoveryGeneration) return undefined
        if (result.diagnostic) {
          setState("discoveryFeedback", { type: "diagnostic", diagnostic: result.diagnostic })
          return result
        }
        const manual = state.models.filter((model) => model.source === "manual")
        const manualIDs = new Set(manual.map((model) => model.id))
        const models = [...manual, ...result.models.filter((model) => !manualIDs.has(model.id))]
        const selectedModelID = models.some((model) => model.id === state.selectedModelID)
          ? state.selectedModelID
          : models[0]?.id
        invalidateTest()
        setState("models", models)
        setState("selectedModelID", selectedModelID)
        setState("discoveryFeedback", { type: "success", count: result.models.length })
        return result
      } catch (error) {
        if (generation !== discoveryGeneration) return undefined
        setState("discoveryFeedback", { type: "unexpected" })
        throw redactedError(error, secrets)
      } finally {
        if (generation === discoveryGeneration) setState("discovering", false)
      }
    },
    async test() {
      const modelID = state.selectedModelID
      if (!modelID) throw recordError(new Error("Choose a model before testing."))
      const generation = ++testGeneration
      setState("testing", true)
      clearLegacyFeedback()
      try {
        const result = await options.operations.test({ draft: input(), modelID })
        if (generation !== testGeneration) return result
        setState("report", result)
        setState("diagnostic", result.diagnostic)
        return result
      } catch (error) {
        if (generation !== testGeneration) return undefined
        throw recordError(error)
      } finally {
        if (generation === testGeneration) setState("testing", false)
      }
    },
    setTestReport(report: ProductCapabilityReport | undefined) {
      setState("report", report)
    },
    canSave() {
      if (state.models.length === 0 || state.credentialRecoveryRequired) return false
      try {
        input()
        return !state.saving && !state.deleting && !state.selectingDefault
      } catch {
        return false
      }
    },
    canSelectDefault() {
      return Boolean(
        state.profileID &&
          state.selectedModelID &&
          persistedModelIDs.has(state.selectedModelID) &&
          !state.saving &&
          !state.deleting &&
          !state.deleteConfirmation &&
          !state.selectingDefault,
      )
    },
    selectDefault() {
      if (defaultPromise) return defaultPromise
      if (!controller.canSelectDefault() || !state.profileID || !state.selectedModelID) {
        return Promise.reject(
          recordError(new Error("Choose a model from a saved model source before making it the default.")),
        )
      }
      setState("selectingDefault", true)
      clearLegacyFeedback()
      defaultPromise = options.operations
        .selectDefault({ profileID: state.profileID, modelID: state.selectedModelID })
        .catch((error) => {
          throw recordError(error)
        })
        .finally(() => {
          setState("selectingDefault", false)
          defaultPromise = undefined
        })
      return defaultPromise
    },
    save() {
      if (savePromise) return savePromise
      if (state.models.length === 0)
        return Promise.reject(recordError(new Error("Add at least one model before saving.")))
      let value: ProductProviderProfileInput
      try {
        value = input()
      } catch (error) {
        return Promise.reject(recordError(error))
      }
      const secrets = credentialValues()
      setState("saving", true)
      clearLegacyFeedback()
      savePromise = options.operations
        .save(value)
        .then(adoptProfile)
        .catch((error) => {
          if (isCommittedProductProfileError(error)) adoptProfile(error.profile)
          throw recordError(error, secrets)
        })
        .finally(() => {
          setState("saving", false)
          savePromise = undefined
        })
      return savePromise
    },
    requestDelete() {
      if (!state.profileID || state.selectingDefault) return
      setState("deleteConfirmation", true)
      clearLegacyFeedback()
    },
    cancelDelete() {
      if (state.deleting) return
      setState("deleteConfirmation", false)
    },
    confirmDelete() {
      if (deletePromise) return deletePromise
      if (!state.profileID || !state.deleteConfirmation || state.selectingDefault)
        return Promise.reject(new Error("Confirm profile deletion first."))
      setState("deleting", true)
      clearLegacyFeedback()
      deletePromise = options.operations
        .remove(state.profileID)
        .then(() => {
          persistedModelIDs.clear()
          setState("profileID", undefined)
        })
        .catch((error) => {
          throw recordError(error)
        })
        .finally(() => {
          setState("deleting", false)
          setState("deleteConfirmation", false)
          deletePromise = undefined
        })
      return deletePromise
    },
    cancel() {
      invalidateDiscovery()
      testGeneration += 1
      detectionGeneration += 1
      setState("testing", false)
      setState("detecting", false)
      clearLegacyFeedback()
    },
    input,
  }

  function recordError(error: unknown, secrets = credentialValues()) {
    const safe = redactedError(error, secrets)
    setState("error", safe.message)
    return safe
  }

  function redactedError(error: unknown, secrets = credentialValues()) {
    return new Error(redact(error instanceof Error ? error.message : String(error), secrets))
  }

  function credentialValues() {
    return [apiKey, ...secretHeaders.values()].filter((value) => value.length > 0)
  }

  function redact(message: string, secrets: string[]) {
    return secrets.reduce((safe, secret) => safe.split(secret).join("[redacted]"), message)
  }

  return Object.freeze(controller)
}

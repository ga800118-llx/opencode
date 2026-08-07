import {
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
  headers: HeaderDraft[]
  models: ProductProviderModel[]
  modelQuery: string
  selectedModelID?: string
  settings: {
    timeoutMs: number
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
  saving: boolean
  deleting: boolean
  deleteConfirmation: boolean
  error?: string
  diagnostic?: string
  discoveryFeedback?: ModelDiscoveryFeedback
}

const KIND_DEFAULTS: Record<ProductProviderKind, { name: string; baseURL: string }> = {
  "openai-compatible": { name: "Private endpoint", baseURL: "https://api.example.com/v1" },
  ollama: { name: "Ollama", baseURL: "http://127.0.0.1:11434" },
  "lm-studio": { name: "LM Studio", baseURL: "http://127.0.0.1:1234/v1" },
  "custom-local": { name: "Local endpoint", baseURL: "http://127.0.0.1:8000/v1" },
}

const DEFAULT_SETTINGS = {
  timeoutMs: 30_000,
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

  const [state, setState] = createStore<FormState>({
    mode: initial ? "edit" : "create",
    ...(initial ? { profileID: initial.id } : {}),
    kind: initial?.kind ?? "openai-compatible",
    name: initial?.name ?? KIND_DEFAULTS["openai-compatible"].name,
    baseURL: initial?.baseURL ?? KIND_DEFAULTS["openai-compatible"].baseURL,
    apiKey: "",
    apiKeyPresent: initial?.hasApiKey ?? false,
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
      timeoutMs: initial?.settings.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs,
      contextLimit: initial?.settings.contextLimit ?? DEFAULT_SETTINGS.contextLimit,
      outputLimit: initial?.settings.outputLimit ?? DEFAULT_SETTINGS.outputLimit,
      proxyURL: "",
      allowInsecureTls: false,
    },
    ...(initial?.test ? { report: initial.test } : {}),
    localCandidates: [],
    discovering: false,
    testing: false,
    detecting: false,
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

  const invalidateDiscovery = () => {
    discoveryGeneration += 1
    setState("discovering", false)
    clearDiscoveryFeedback()
  }

  const input = (): ProductProviderProfileInput => {
    if (!isCompleteEndpoint(state.baseURL)) throw new Error(INVALID_ENDPOINT_MESSAGE)
    const headers: ProductProviderHeader[] = state.headers.flatMap<ProductProviderHeader>((header, index) => {
      if (!header.name.trim()) return []
      if (header.sensitive) {
        const secret = secretHeaders.get(index)
        return [{ name: header.name, sensitive: true, hasValue: Boolean(secret) || header.hasValue }]
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
        if (!header.sensitive) return []
        const value = secretHeaders.get(index)
        return value === undefined ? [] : [[header.name, value]]
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
        timeoutMs: state.settings.timeoutMs,
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
    apiKeyValue: () => apiKey,
    headerValue: (index: number) =>
      state.headers[index]?.sensitive ? (secretHeaders.get(index) ?? "") : (state.headers[index]?.value ?? ""),
    setKind(kind: ProductProviderKind) {
      const defaults = KIND_DEFAULTS[kind]
      invalidateDiscovery()
      apiKey = ""
      secretHeaders.clear()
      setState({
        ...state,
        kind,
        name: defaults.name,
        baseURL: defaults.baseURL,
        apiKeyPresent: false,
        headers: [],
        models: [],
        selectedModelID: undefined,
        report: undefined,
      })
      clearLegacyFeedback()
    },
    setField(field: "name" | "baseURL", value: string) {
      if (field === "baseURL") invalidateDiscovery()
      setState(field, value)
      clearLegacyFeedback()
    },
    setSetting(field: "timeoutMs" | "contextLimit" | "outputLimit", value: number) {
      if (field === "timeoutMs") invalidateDiscovery()
      setState("settings", field, value)
      clearLegacyFeedback()
    },
    setProxyURL(value: string) {
      invalidateDiscovery()
      setState("settings", "proxyURL", value)
      clearLegacyFeedback()
    },
    setApiKey(value: string) {
      invalidateDiscovery()
      apiKey = value
      setState("apiKeyPresent", Boolean(value) || Boolean(initial?.hasApiKey))
      clearLegacyFeedback()
    },
    addHeader(header: { name?: string; value?: string; sensitive?: boolean } = {}) {
      const index = state.headers.length
      const sensitive = header.sensitive === true
      invalidateDiscovery()
      if (sensitive && header.value !== undefined) secretHeaders.set(index, header.value)
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
      clearLegacyFeedback()
    },
    setHeader(index: number, patch: Partial<Pick<HeaderDraft, "name" | "value" | "sensitive">>) {
      const current = state.headers[index]
      if (!current) return
      const sensitive = patch.sensitive ?? current.sensitive
      const nextValue = patch.value ?? controller.headerValue(index)
      invalidateDiscovery()
      if (sensitive) secretHeaders.set(index, nextValue)
      else secretHeaders.delete(index)
      setState("headers", index, {
        ...current,
        ...patch,
        value: sensitive ? "" : nextValue,
        sensitive,
        hasValue: sensitive ? Boolean(nextValue) || current.hasValue : Boolean(nextValue),
      })
      clearLegacyFeedback()
    },
    removeHeader(index: number) {
      const values = state.headers.map((_, current) => controller.headerValue(current))
      invalidateDiscovery()
      setState(
        "headers",
        produce((rows) => {
          rows.splice(index, 1)
        }),
      )
      secretHeaders.clear()
      state.headers.forEach((header, current) => {
        if (!header.sensitive) return
        const value = values[current >= index ? current + 1 : current]
        if (value) secretHeaders.set(current, value)
      })
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
      setState(
        "models",
        produce((models) => {
          const index = models.findIndex((model) => model.id === modelID)
          if (index >= 0) models.splice(index, 1)
        }),
      )
      if (state.selectedModelID === modelID) setState("selectedModelID", state.models[0]?.id)
      if (state.report?.modelID === modelID) setState("report", undefined)
      clearLegacyFeedback()
    },
    selectModel(modelID: string) {
      if (!state.models.some((model) => model.id === modelID)) return
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
      detectionGeneration += 1
      setState("kind", candidate.kind)
      setState("name", candidate.name)
      setState("baseURL", candidate.baseURL)
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
        setState("diagnostic", result.diagnostic?.message)
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
      if (state.models.length === 0) return false
      try {
        input()
        return !state.saving && !state.deleting
      } catch {
        return false
      }
    },
    canSelectDefault() {
      return Boolean(
        state.profileID &&
          state.selectedModelID &&
          state.report?.modelID === state.selectedModelID &&
          state.report.classification === "agent-capable" &&
          !state.saving &&
          !state.deleting,
      )
    },
    async selectDefault() {
      if (!controller.canSelectDefault() || !state.profileID || !state.selectedModelID) {
        throw recordError(new Error("Only an agent-capable tested model can be the default."))
      }
      clearLegacyFeedback()
      try {
        return await options.operations.selectDefault({ profileID: state.profileID, modelID: state.selectedModelID })
      } catch (error) {
        throw recordError(error)
      }
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
      setState("saving", true)
      clearLegacyFeedback()
      savePromise = options.operations
        .save(value)
        .catch((error) => {
          throw recordError(error)
        })
        .finally(() => {
          setState("saving", false)
          savePromise = undefined
        })
      return savePromise
    },
    requestDelete() {
      if (!state.profileID) return
      setState("deleteConfirmation", true)
      clearLegacyFeedback()
    },
    cancelDelete() {
      if (state.deleting) return
      setState("deleteConfirmation", false)
    },
    confirmDelete() {
      if (deletePromise) return deletePromise
      if (!state.profileID || !state.deleteConfirmation)
        return Promise.reject(new Error("Confirm profile deletion first."))
      setState("deleting", true)
      clearLegacyFeedback()
      deletePromise = options.operations
        .remove(state.profileID)
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

  function recordError(error: unknown) {
    const safe = redactedError(error)
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

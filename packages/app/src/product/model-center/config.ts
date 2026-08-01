import type { ProductProviderProfile } from "./contracts"

const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

export type ProductOpenCodeProviderConfig = {
  readonly npm: typeof OPENAI_COMPATIBLE
  readonly name: string
  readonly env: readonly string[]
  readonly options: {
    readonly baseURL: string
    readonly timeout: number
    readonly headers?: Readonly<Record<string, string>>
  }
  readonly models: Readonly<
    Record<
      string,
      {
        readonly name: string
        readonly tool_call?: boolean
        readonly limit: { readonly context: number; readonly output: number }
      }
    >
  >
}

export function profileCredentialEnvironment(profileID: string) {
  return `AGENT_PROFILE_${environmentSegment(profileID)}_API_KEY`
}

export function profileCredentialProxyBaseURLEnvironment(profileID: string) {
  return `AGENT_PROFILE_${environmentSegment(profileID)}_PROXY_BASE_URL`
}

export function profileProviderID(profileID: string) {
  return `agent-profile-${profileID.toLowerCase()}`
}

export function profileSensitiveHeaderEnvironment(profileID: string, headerName: string) {
  return `AGENT_PROFILE_${environmentSegment(profileID)}_HEADER_${environmentSegment(headerName)}_${hash(headerName.toLowerCase())}`
}

export function serializeProviderProfile(profile: ProductProviderProfile): ProductOpenCodeProviderConfig {
  const headers = Object.fromEntries(
    profile.headers.flatMap((header) => {
      if (header.sensitive) return []
      return header.value ? [[header.name, header.value]] : []
    }),
  )
  const testedModel = profile.test?.classification === "agent-capable" ? profile.test.modelID : undefined
  return Object.freeze({
    npm: OPENAI_COMPATIBLE,
    name: profile.name,
    env: Object.freeze(profile.runtime?.credentialProxy ? [profileCredentialEnvironment(profile.id)] : []),
    options: Object.freeze({
      baseURL: providerBaseURL(profile),
      timeout: profile.settings.timeoutMs,
      ...(Object.keys(headers).length ? { headers: Object.freeze(headers) } : {}),
    }),
    models: Object.freeze(
      Object.fromEntries(
        profile.models.map((model) => [
          model.id,
          Object.freeze({
            name: model.name,
            ...(model.id === testedModel && profile.test?.checks.toolCalling ? { tool_call: true } : {}),
            limit: Object.freeze({
              context: profile.settings.contextLimit,
              output: profile.settings.outputLimit,
            }),
          }),
        ]),
      ),
    ),
  })
}

export function enableProviderPatch(profile: ProductProviderProfile, disabledProviders: readonly string[]) {
  return Object.freeze({
    provider: Object.freeze({ [profile.providerID]: serializeProviderProfile(profile) }),
    disabled_providers: Object.freeze(disabledProviders.filter((id) => id !== profile.providerID)),
  })
}

export function disableProviderPatch(providerID: string, disabledProviders: readonly string[]) {
  return Object.freeze({
    disabled_providers: Object.freeze(
      disabledProviders.includes(providerID) ? [...disabledProviders] : [...disabledProviders, providerID],
    ),
  })
}

export function defaultModelPatch(profile: ProductProviderProfile, modelID: string) {
  const valid = profile.models.some((model) => model.id === modelID)
  const tested = profile.test?.modelID === modelID && profile.test.classification === "agent-capable"
  if (!valid || !tested) throw new Error("Only an agent-capable tested model can be the default.")
  return Object.freeze({ model: `${profile.providerID}/${modelID}` })
}

function providerBaseURL(profile: ProductProviderProfile) {
  if (profile.runtime?.credentialProxy) return `{env:${profileCredentialProxyBaseURLEnvironment(profile.id)}}`
  const runtimeBaseURL = profile.runtime?.baseURL ?? profile.baseURL
  if (profile.kind !== "ollama") return runtimeBaseURL.replace(/\/$/, "")
  const base = runtimeBaseURL.replace(/\/$/, "")
  return base.endsWith("/v1") ? base : `${base}/v1`
}

function environmentSegment(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "VALUE"
}

function hash(value: string) {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return (result >>> 0).toString(16).toUpperCase().padStart(8, "0")
}

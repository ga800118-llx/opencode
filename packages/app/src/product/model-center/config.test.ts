import { describe, expect, test } from "bun:test"
import type { ProductProviderProfile } from "./contracts"
import {
  defaultModelPatch,
  disableProviderPatch,
  enableProviderPatch,
  profileCredentialEnvironment,
  profileSensitiveHeaderEnvironment,
  serializeProviderProfile,
} from "./config"

const profile = {
  id: "01ab-cd",
  providerID: "agent-profile-01ab-cd",
  name: "Local Coder",
  kind: "ollama",
  baseURL: "http://127.0.0.1:11434/",
  credentialRef: "model-profile:01ab-cd",
  hasApiKey: true,
  headers: [
    { name: "X-Tenant", value: "alpha", sensitive: false, hasValue: true },
    { name: "Authorization-Extra", sensitive: true, hasValue: true },
  ],
  models: [
    { id: "qwen-coder", name: "Qwen Coder", source: "discovered" },
    { id: "manual-coder", name: "Manual Coder", source: "manual" },
  ],
  defaultModelID: "qwen-coder",
  settings: {
    contextLimit: 64_000,
    outputLimit: 8_000,
    allowInsecureTls: false,
  },
  test: {
    modelID: "qwen-coder",
    classification: "agent-capable",
    checks: { basicChat: true, streaming: true, toolCalling: true },
    testedAt: 123,
    requestID: "req-safe",
  },
  createdAt: 1,
  updatedAt: 2,
} satisfies ProductProviderProfile

describe("model profile config serialization", () => {
  test("fails closed when a credentialed profile has no runtime proxy", () => {
    const config = serializeProviderProfile(profile)
    const raw = JSON.stringify(config)

    expect(config).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Local Coder",
      env: [],
      options: {
        baseURL: "http://127.0.0.1:11434/v1",
        timeout: false,
        headerTimeout: false,
        headers: {
          "X-Tenant": "alpha",
        },
      },
      models: {
        "qwen-coder": {
          name: "Qwen Coder",
          tool_call: true,
          limit: { context: 64_000, output: 8_000 },
        },
        "manual-coder": {
          name: "Manual Coder",
          limit: { context: 64_000, output: 8_000 },
        },
      },
    })
    expect(raw).not.toContain("model-profile:01ab-cd")
    expect(raw).not.toContain("Authorization-Extra")
    expect(raw).not.toContain("req-safe")
    expect(config.options).not.toHaveProperty("chunkTimeout")
  })

  test("builds deterministic environment names and config patches", () => {
    expect(profileCredentialEnvironment(profile.id)).toBe("AGENT_PROFILE_01AB_CD_API_KEY")
    expect(profileSensitiveHeaderEnvironment(profile.id, "Authorization-Extra")).toBe(
      "AGENT_PROFILE_01AB_CD_HEADER_AUTHORIZATION_EXTRA_B6EBEFD5",
    )
    expect(enableProviderPatch(profile, ["openai", profile.providerID])).toEqual({
      provider: { [profile.providerID]: serializeProviderProfile(profile) },
      disabled_providers: ["openai"],
    })
    expect(disableProviderPatch(profile.providerID, ["openai"])).toEqual({
      disabled_providers: ["openai", profile.providerID],
    })
    expect(defaultModelPatch(profile, "qwen-coder")).toEqual({
      model: `${profile.providerID}/qwen-coder`,
    })
  })

  test("routes sensitive headers through a credential proxy without serializing header references", () => {
    const config = serializeProviderProfile({
      ...profile,
      runtime: {
        baseURL: "http://127.0.0.1:32123/model-profile/01ab-cd/",
        credentialProxy: true,
      },
    })

    expect(config.env).toEqual(["AGENT_PROFILE_01AB_CD_API_KEY"])
    expect(config.options).toEqual({
      baseURL: "{env:AGENT_PROFILE_01AB_CD_PROXY_BASE_URL}",
      timeout: false,
      headerTimeout: false,
      headers: { "X-Tenant": "alpha" },
    })
    expect(JSON.stringify(config)).not.toContain("Authorization-Extra")
  })

  test("allows an untested profile model as the default", () => {
    expect(defaultModelPatch(profile, "manual-coder")).toEqual({
      model: `${profile.providerID}/manual-coder`,
    })
  })

  test("refuses to make a model outside the profile the default", () => {
    expect(() => defaultModelPatch(profile, "missing-coder")).toThrow(
      /^The default model must belong to this profile\.$/,
    )
  })
})

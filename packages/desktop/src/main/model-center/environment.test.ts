import { describe, expect, test } from "bun:test"
import type { ProductProviderProfile } from "@opencode-ai/app/product/model-center"
import type { ProductCredentialEnvelope, ProductCredentialService } from "./credentials"
import { createModelCredentialEnvironment } from "./environment"

const profile = {
  id: "profile-one",
  providerID: "agent-profile-profile-one",
  name: "Private",
  kind: "openai-compatible",
  baseURL: "https://models.example.test/v1",
  credentialRef: "model-profile:profile-one",
  hasApiKey: true,
  headers: [
    { name: "X-Private-Token", sensitive: true, hasValue: true },
    { name: "X-Missing", sensitive: true, hasValue: true },
    { name: "X-Tenant", value: "alpha", sensitive: false, hasValue: true },
  ],
  models: [{ id: "coder", name: "Coder", source: "manual" }],
  settings: { timeoutMs: 30_000, contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false },
  createdAt: 1,
  updatedAt: 2,
} satisfies ProductProviderProfile

function credentials(values: Record<string, ProductCredentialEnvelope | Error>): ProductCredentialService {
  return {
    capabilities: () => ({
      namespace: "dev.agent.desktop.credentials",
      backend: "macos-keychain",
      available: true,
      operations: { read: true, write: true, delete: true },
    }),
    has: (reference) => reference in values,
    read(reference) {
      const value = values[reference]
      if (value instanceof Error) throw value
      return value
    },
    write: () => undefined,
    delete: () => undefined,
  }
}

describe("createModelCredentialEnvironment", () => {
  test("maps API keys and sensitive headers to deterministic child-only variables", () => {
    const warnings: unknown[] = []
    const environment = createModelCredentialEnvironment({
      profiles: [profile],
      credentials: credentials({
        "model-profile:profile-one": {
          apiKey: "sk-test-secret",
          headers: { "x-private-token": "Bearer secret-header" },
        },
      }),
      warn: (warning) => warnings.push(warning),
    })

    expect(environment).toEqual({
      AGENT_PROFILE_PROFILE_ONE_API_KEY: "sk-test-secret",
      AGENT_PROFILE_PROFILE_ONE_HEADER_X_PRIVATE_TOKEN_9A65D1A5: "Bearer secret-header",
    })
    expect(warnings).toEqual([{ profileID: "profile-one", kind: "missing-header" }])
    expect(JSON.stringify(warnings)).not.toContain("sk-test-secret")
    expect(JSON.stringify(warnings)).not.toContain("Bearer secret-header")
    expect(Object.isFrozen(environment)).toBe(true)
  })

  test("contains missing and failed credential reads per profile", () => {
    const warnings: unknown[] = []
    const second = { ...profile, id: "profile-two", credentialRef: "model-profile:profile-two" }
    const environment = createModelCredentialEnvironment({
      profiles: [profile, second],
      credentials: credentials({ "model-profile:profile-two": new Error("raw decrypt secret") }),
      warn: (warning) => warnings.push(warning),
    })

    expect(environment).toEqual({})
    expect(warnings).toEqual([
      { profileID: "profile-one", kind: "missing-credential" },
      { profileID: "profile-two", kind: "credential-read" },
    ])
    expect(JSON.stringify(warnings)).not.toContain("raw decrypt secret")
  })
})

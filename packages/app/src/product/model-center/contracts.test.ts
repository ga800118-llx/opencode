import { describe, expect, test } from "bun:test"
import { normalizeProviderProfileInput, sanitizeProviderProfile } from "./contracts"

const input = {
  name: "  Private Gateway  ",
  kind: "openai-compatible",
  baseURL: "https://models.example.test/v1/",
  headers: [
    { name: "X-Tenant", value: "alpha", sensitive: false },
    { name: "X-Private-Token", sensitive: true, hasValue: true },
  ],
  models: [
    { id: " coder-large ", name: " Coder Large ", source: "manual" },
    { id: "reasoner", name: "Reasoner", source: "discovered" },
  ],
  defaultModelID: "coder-large",
  settings: {
    timeoutMs: 30_000,
    contextLimit: 128_000,
    outputLimit: 16_000,
    allowInsecureTls: false,
  },
  credentials: {
    apiKey: "sk-test-secret",
    headers: { "X-Private-Token": "Bearer secret-header" },
  },
} as const

describe("normalizeProviderProfileInput", () => {
  test("normalizes a private profile without echoing field values in validation errors", () => {
    expect(normalizeProviderProfileInput(input)).toEqual({
      ...input,
      name: "Private Gateway",
      baseURL: "https://models.example.test/v1",
      headers: [
        { name: "X-Tenant", value: "alpha", sensitive: false, hasValue: true },
        { name: "X-Private-Token", sensitive: true, hasValue: true },
      ],
      models: [
        { id: "coder-large", name: "Coder Large", source: "manual" },
        { id: "reasoner", name: "Reasoner", source: "discovered" },
      ],
    })

    expect(() => normalizeProviderProfileInput({ ...input, baseURL: "sk-test-secret" })).toThrow(
      "A valid HTTP or HTTPS endpoint is required.",
    )
  })

  test("rejects duplicate models, unsafe TLS, unsafe headers, and non-loopback local services", () => {
    expect(() =>
      normalizeProviderProfileInput({ ...input, models: [...input.models, input.models[0]] }),
    ).toThrow("Model IDs must be unique.")
    expect(() =>
      normalizeProviderProfileInput({ ...input, settings: { ...input.settings, allowInsecureTls: true } }),
    ).toThrow("Insecure TLS is not supported by this desktop runtime.")
    expect(() =>
      normalizeProviderProfileInput({ ...input, headers: [{ name: "Bad Header", value: "x", sensitive: false }] }),
    ).toThrow("Header names must use valid HTTP token characters.")
    expect(() =>
      normalizeProviderProfileInput({ ...input, kind: "ollama", baseURL: "https://models.example.test" }),
    ).toThrow("Local model services must use a loopback endpoint.")
    expect(() =>
      normalizeProviderProfileInput({
        ...input,
        settings: { ...input.settings, proxyURL: "https://proxy.example.test" },
      }),
    ).toThrow("Per-profile proxies are not supported by this desktop runtime.")
  })

  test("requires positive bounded numeric settings and a selected known model", () => {
    expect(() =>
      normalizeProviderProfileInput({ ...input, settings: { ...input.settings, timeoutMs: 0 } }),
    ).toThrow("Timeout must be between 1000 and 900000 milliseconds.")
    expect(() => normalizeProviderProfileInput({ ...input, defaultModelID: "missing" })).toThrow(
      "The default model must belong to this profile.",
    )
  })
})

describe("sanitizeProviderProfile", () => {
  test("returns a renderer-safe immutable profile", () => {
    const profile = sanitizeProviderProfile({
      ...normalizeProviderProfileInput(input),
      id: "profile-1",
      providerID: "agent-profile-profile-1",
      credentialRef: "model-profile:profile-1",
      hasApiKey: true,
      createdAt: 1,
      updatedAt: 2,
    })

    expect(JSON.stringify(profile)).not.toContain("sk-test-secret")
    expect(JSON.stringify(profile)).not.toContain("Bearer secret-header")
    expect(profile.headers[1]).toEqual({ name: "X-Private-Token", sensitive: true, hasValue: true })
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.models)).toBe(true)
  })
})

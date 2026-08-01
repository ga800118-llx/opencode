import { describe, expect, test } from "bun:test"
import { createProductCredentialCapabilities } from "../../product/host"
import { createCredentialService, type CredentialStore, type SafeStorageAdapter } from "./credentials"

function fixture(input: { platform?: NodeJS.Platform; available?: boolean } = {}) {
  const values = new Map<string, unknown>()
  const writes: unknown[] = []
  const store: CredentialStore = {
    get(key) {
      return values.get(key)
    },
    set(key, value) {
      writes.push(value)
      values.set(key, value)
    },
    delete(key) {
      values.delete(key)
    },
  }
  const safeStorage: SafeStorageAdapter = {
    isEncryptionAvailable: () => input.available ?? true,
    encryptString: (plainText) => Buffer.from(`cipher:${Buffer.from(plainText).toString("base64")}`),
    decryptString: (encrypted) => {
      const value = encrypted.toString()
      if (!value.startsWith("cipher:")) throw new Error("raw decrypt detail")
      return Buffer.from(value.slice(7), "base64").toString()
    },
  }
  const service = createCredentialService({
    namespace: "dev.agent.desktop.credentials",
    platform: input.platform ?? "darwin",
    safeStorage,
    store,
  })
  return { service, values, writes }
}

describe("createCredentialService", () => {
  test("writes, reads, updates, and deletes encrypted credential envelopes", () => {
    const fake = fixture()
    fake.service.write("model-profile:one", {
      apiKey: "sk-test-secret",
      headers: { "X-Private-Token": "Bearer secret-header" },
    })

    expect(fake.service.has("model-profile:one")).toBe(true)
    expect(fake.service.read("model-profile:one")).toEqual({
      apiKey: "sk-test-secret",
      headers: { "X-Private-Token": "Bearer secret-header" },
    })
    expect(JSON.stringify(fake.writes)).not.toContain("sk-test-secret")
    expect(JSON.stringify(fake.writes)).not.toContain("Bearer secret-header")

    fake.service.write("model-profile:one", { headers: { Authorization: "second-secret" } })
    expect(fake.service.read("model-profile:one")).toEqual({ headers: { Authorization: "second-secret" } })

    fake.service.delete("model-profile:one")
    fake.service.delete("model-profile:one")
    expect(fake.service.has("model-profile:one")).toBe(false)
    expect(fake.service.read("model-profile:one")).toBeUndefined()
  })

  test("removes an entry when an empty envelope is written", () => {
    const fake = fixture()
    fake.service.write("model-profile:one", { apiKey: "secret" })
    fake.service.write("model-profile:one", { headers: {} })
    expect(fake.service.has("model-profile:one")).toBe(false)
  })

  test("reports unavailable operations outside an available macOS keychain", () => {
    for (const item of [
      { platform: "darwin", available: false, backend: "macos-keychain" },
      { platform: "win32", available: true, backend: "windows-credential-manager" },
      { platform: "linux", available: true, backend: "unsupported" },
    ] as const) {
      const fake = fixture({ platform: item.platform, available: item.available })
      expect(fake.service.capabilities()).toEqual(
        createProductCredentialCapabilities("dev.agent.desktop.credentials", item.platform, false),
      )
      expect(fake.service.capabilities().backend).toBe(item.backend)
      expect(() => fake.service.write("model-profile:one", { apiKey: "secret" })).toThrow(
        "Secure credential storage is unavailable.",
      )
    }
  })

  test("maps corrupt ciphertext and malformed envelopes to fixed errors", () => {
    const fake = fixture()
    fake.values.set("credentials", { "model-profile:bad-cipher": "not-cipher" })
    expect(() => fake.service.read("model-profile:bad-cipher")).toThrow(
      "The saved credential could not be decrypted.",
    )

    fake.values.set("credentials", {
      "model-profile:bad-json": Buffer.from("cipher:not-base64-json").toString("base64"),
    })
    expect(() => fake.service.read("model-profile:bad-json")).toThrow("The saved credential is invalid.")
  })

  test("rejects unsafe references and invalid secret values without reflecting them", () => {
    const fake = fixture()
    expect(() => fake.service.write("../sk-test-secret", { apiKey: "secret" })).toThrow(
      "The credential reference is invalid.",
    )
    expect(() => fake.service.write("model-profile:one", { apiKey: "" })).toThrow(
      "The credential value is invalid.",
    )
    expect(() => fake.service.write("model-profile:one", { headers: { "Bad Header": "secret" } })).toThrow(
      "The credential header name is invalid.",
    )
  })
})

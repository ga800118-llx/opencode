import { describe, expect, test } from "bun:test"
import { createProductCredentialCapabilities, type ProductCredentialBackend } from "../../product/host"
import { createCredentialService, type CredentialStore, type SafeStorageAdapter } from "./credentials"

function fixture(
  input: {
    platform?: NodeJS.Platform
    backend?: ProductCredentialBackend
    available?: boolean
    availabilityThrows?: boolean
  } = {},
) {
  const values = new Map<string, unknown>()
  const writes: unknown[] = []
  const calls = { availability: 0, decrypt: 0 }
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
    isEncryptionAvailable: () => {
      calls.availability += 1
      if (input.availabilityThrows) throw new Error("raw availability detail")
      return input.available ?? true
    },
    encryptString: (plainText) => Buffer.from(`cipher:${Buffer.from(plainText).toString("base64")}`),
    decryptString: (encrypted) => {
      calls.decrypt += 1
      const value = encrypted.toString()
      if (!value.startsWith("cipher:")) throw new Error("raw decrypt detail")
      return Buffer.from(value.slice(7), "base64").toString()
    },
  }
  const service = createCredentialService({
    namespace: "dev.agent.desktop.credentials",
    platform: input.platform ?? "darwin",
    backend: input.backend,
    safeStorage,
    store,
  })
  return { service, values, writes, calls }
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

  test("caches capability checks and decrypted envelopes until the credential changes", () => {
    const fake = fixture()
    fake.service.write("model-profile:one", { apiKey: "first-secret" })

    expect(fake.service.capabilities().available).toBe(true)
    expect(fake.service.capabilities().available).toBe(true)
    expect(fake.service.read("model-profile:one")?.apiKey).toBe("first-secret")
    expect(fake.service.read("model-profile:one")?.apiKey).toBe("first-secret")
    expect(fake.calls).toEqual({ availability: 1, decrypt: 0 })

    fake.service.write("model-profile:one", { apiKey: "second-secret" })
    expect(fake.service.read("model-profile:one")?.apiKey).toBe("second-secret")
    expect(fake.calls).toEqual({ availability: 1, decrypt: 0 })

    fake.service.delete("model-profile:one")
    expect(fake.service.read("model-profile:one")).toBeUndefined()
    expect(fake.calls).toEqual({ availability: 1, decrypt: 0 })
  })

  test("decrypts a stored envelope only once", () => {
    const fake = fixture()
    fake.values.set("credentials", {
      "model-profile:stored": Buffer.from(
        `cipher:${Buffer.from(JSON.stringify({ apiKey: "stored-secret" })).toString("base64")}`,
      ).toString("base64"),
    })

    expect(fake.service.read("model-profile:stored")?.apiKey).toBe("stored-secret")
    expect(fake.service.read("model-profile:stored")?.apiKey).toBe("stored-secret")
    expect(fake.calls).toEqual({ availability: 1, decrypt: 1 })
  })

  test("treats foreign ciphertext as absent for the local encrypted file backend", () => {
    const fake = fixture({ backend: "local-encrypted-file" })
    fake.values.set("credentials", {
      "model-profile:foreign": Buffer.from("foreign-ciphertext").toString("base64"),
    })

    expect(fake.service.has("model-profile:foreign")).toBe(false)
    expect(fake.calls.decrypt).toBe(1)
  })

  test("preserves presence-only checks for system credential backends", () => {
    for (const input of [
      { platform: "darwin", backend: "macos-keychain" },
      { platform: "win32", backend: "windows-credential-manager" },
    ] as const) {
      const fake = fixture(input)
      fake.values.set("credentials", {
        "model-profile:foreign": Buffer.from("foreign-ciphertext").toString("base64"),
      })

      expect(fake.service.has("model-profile:foreign")).toBe(true)
      expect(fake.calls.decrypt).toBe(0)
    }
  })

  test("removes an entry when an empty envelope is written", () => {
    const fake = fixture()
    fake.service.write("model-profile:one", { apiKey: "secret" })
    fake.service.write("model-profile:one", { headers: {} })
    expect(fake.service.has("model-profile:one")).toBe(false)
  })

  test("writes, reads, and deletes encrypted credential envelopes on Windows", () => {
    const fake = fixture({ platform: "win32" })
    fake.service.write("model-profile:windows", {
      apiKey: "sk-windows-secret",
      headers: { Authorization: "Bearer windows-header" },
    })

    expect(fake.service.capabilities()).toEqual({
      namespace: "dev.agent.desktop.credentials",
      backend: "windows-credential-manager",
      available: true,
      operations: { read: true, write: true, delete: true },
    })
    expect(fake.service.read("model-profile:windows")).toEqual({
      apiKey: "sk-windows-secret",
      headers: { Authorization: "Bearer windows-header" },
    })
    expect(JSON.stringify(fake.values.get("credentials"))).not.toContain("sk-windows-secret")
    expect(JSON.stringify(fake.values.get("credentials"))).not.toContain("Bearer windows-header")

    fake.service.delete("model-profile:windows")
    expect(fake.service.has("model-profile:windows")).toBe(false)
    expect(fake.values.has("credentials")).toBe(false)
  })

  test("reports unavailable operations without supported encryption", () => {
    for (const item of [
      { platform: "darwin", available: false, backend: "macos-keychain" },
      { platform: "win32", available: false, backend: "windows-credential-manager" },
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

  test("fails closed when safeStorage availability checks throw", () => {
    const fake = fixture({ platform: "win32", availabilityThrows: true })

    expect(fake.service.capabilities()).toEqual(
      createProductCredentialCapabilities("dev.agent.desktop.credentials", "win32", false),
    )
    expect(() => fake.service.read("model-profile:one")).toThrow("Secure credential storage is unavailable.")
    expect(() => fake.service.write("model-profile:one", { apiKey: "secret" })).toThrow(
      "Secure credential storage is unavailable.",
    )
    expect(() => fake.service.delete("model-profile:one")).toThrow(
      "Secure credential storage is unavailable.",
    )
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

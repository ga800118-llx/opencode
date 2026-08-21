import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createCredentialService, type CredentialStore } from "./credentials"
import { createLocalCredentialStorage } from "./local-credential-storage"

test("encrypts credentials with a stable owner-only local key", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "guai-credential-"))
  const key = path.join(directory, "credential.key")
  const plaintext = "private-api-key"

  try {
    const encrypted = createLocalCredentialStorage(key).encryptString(plaintext)
    expect(encrypted.toString()).not.toContain(plaintext)
    expect(createLocalCredentialStorage(key).decryptString(encrypted)).toBe(plaintext)
    expect((await stat(key)).mode & 0o777).toBe(0o600)
    expect((await readFile(key)).toString()).not.toContain(plaintext)

    const other = createLocalCredentialStorage(path.join(directory, "other.key"))
    expect(() => other.decryptString(encrypted)).toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("replaces a credential encrypted by a different local vault", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "guai-credential-"))
  const values = new Map<string, unknown>()
  const store: CredentialStore = {
    get(key) {
      return values.get(key)
    },
    set(key, value) {
      values.set(key, value)
    },
    delete(key) {
      values.delete(key)
    },
  }
  const reference = "model-profile:local-vault-replacement"

  try {
    const encrypted = createLocalCredentialStorage(path.join(directory, "key-a")).encryptString(
      JSON.stringify({ apiKey: "synthetic-key-a" }),
    )
    const ciphertextA = encrypted.toString("base64")
    values.set("credentials", { [reference]: ciphertextA })

    const storageB = createLocalCredentialStorage(path.join(directory, "key-b"))
    const service = createCredentialService({
      namespace: "dev.agent.desktop.credentials",
      platform: "darwin",
      backend: "local-encrypted-file",
      safeStorage: storageB,
      store,
    })

    expect(service.has(reference)).toBe(false)

    service.write(reference, { apiKey: "synthetic-key-b" })

    expect(values.get("credentials")).not.toEqual({ [reference]: ciphertextA })

    const reloaded = createCredentialService({
      namespace: "dev.agent.desktop.credentials",
      platform: "darwin",
      backend: "local-encrypted-file",
      safeStorage: storageB,
      store,
    })

    expect(reloaded.has(reference)).toBe(true)
    expect(reloaded.read(reference)).toEqual({ apiKey: "synthetic-key-b" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

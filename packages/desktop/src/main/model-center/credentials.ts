import { createProductCredentialCapabilities, type ProductCredentialCapabilities } from "../../product/host"

export type ProductCredentialEnvelope = {
  readonly apiKey?: string
  readonly headers?: Readonly<Record<string, string>>
}

export type CredentialStore = {
  readonly get: (key: string) => unknown
  readonly set: (key: string, value: unknown) => void
  readonly delete: (key: string) => void
}

export type SafeStorageAdapter = {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (plainText: string) => Buffer
  readonly decryptString: (encrypted: Buffer) => string
}

export type ProductCredentialService = {
  readonly capabilities: () => ProductCredentialCapabilities
  readonly has: (reference: string) => boolean
  readonly read: (reference: string) => ProductCredentialEnvelope | undefined
  readonly write: (reference: string, value: ProductCredentialEnvelope) => void
  readonly delete: (reference: string) => void
}

type CredentialServiceOptions = {
  readonly namespace: string
  readonly platform: NodeJS.Platform
  readonly safeStorage: SafeStorageAdapter
  readonly store: CredentialStore
}

const STORE_KEY = "credentials"
const REFERENCE = /^model-profile:[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const MAX_SECRET_LENGTH = 32_768

export function createCredentialService(options: CredentialServiceOptions): ProductCredentialService {
  let available: boolean | undefined
  const cache = new Map<string, ProductCredentialEnvelope>()
  const encryptionAvailable = () => {
    if (available !== undefined) return available
    if (options.platform !== "darwin" && options.platform !== "win32") return false
    try {
      available = options.safeStorage.isEncryptionAvailable()
    } catch {
      available = false
    }
    return available
  }

  const capabilities = () =>
    createProductCredentialCapabilities(options.namespace, options.platform, encryptionAvailable())

  const assertAvailable = () => {
    if (!capabilities().available) throw new Error("Secure credential storage is unavailable.")
  }

  const entries = () => normalizeEntries(options.store.get(STORE_KEY))

  const persist = (next: Record<string, string>) => {
    if (Object.keys(next).length === 0) {
      options.store.delete(STORE_KEY)
      return
    }
    options.store.set(STORE_KEY, Object.freeze({ ...next }))
  }

  return Object.freeze({
    capabilities,
    has(reference) {
      assertReference(reference)
      return typeof entries()[reference] === "string"
    },
    read(reference) {
      assertReference(reference)
      assertAvailable()
      const cached = cache.get(reference)
      if (cached) return cached
      const encrypted = entries()[reference]
      if (!encrypted) return

      let decrypted: string
      try {
        decrypted = options.safeStorage.decryptString(Buffer.from(encrypted, "base64"))
      } catch {
        throw new Error("The saved credential could not be decrypted.")
      }

      try {
        const envelope = freezeEnvelope(normalizeEnvelope(JSON.parse(decrypted)))
        cache.set(reference, envelope)
        return envelope
      } catch {
        throw new Error("The saved credential is invalid.")
      }
    },
    write(reference, value) {
      assertReference(reference)
      assertAvailable()
      const envelope = normalizeEnvelope(value)
      if (!envelope.apiKey && !Object.keys(envelope.headers ?? {}).length) {
        const next = entries()
        delete next[reference]
        persist(next)
        cache.delete(reference)
        return
      }

      let encrypted: Buffer
      try {
        encrypted = options.safeStorage.encryptString(JSON.stringify(envelope))
      } catch {
        throw new Error("The credential could not be encrypted.")
      }
      persist({ ...entries(), [reference]: encrypted.toString("base64") })
      cache.set(reference, freezeEnvelope(envelope))
    },
    delete(reference) {
      assertReference(reference)
      assertAvailable()
      const next = entries()
      cache.delete(reference)
      if (!(reference in next)) return
      delete next[reference]
      persist(next)
    },
  })
}

function normalizeEntries(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => REFERENCE.test(entry[0]) && typeof entry[1] === "string",
    ),
  )
}

function normalizeEnvelope(input: unknown): ProductCredentialEnvelope {
  if (!isRecord(input)) throw new Error("The credential value is invalid.")
  const apiKey = optionalSecret(input.apiKey)
  const headers = input.headers === undefined ? undefined : normalizeHeaders(input.headers)
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
  }
}

function normalizeHeaders(input: unknown): Record<string, string> {
  if (!isRecord(input)) throw new Error("The credential headers are invalid.")
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => {
      if (!HEADER_NAME.test(name)) throw new Error("The credential header name is invalid.")
      const secret = optionalSecret(value)
      if (!secret) throw new Error("The credential value is invalid.")
      return [name, secret]
    }),
  )
}

function optionalSecret(input: unknown) {
  if (input === undefined) return
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_SECRET_LENGTH) {
    throw new Error("The credential value is invalid.")
  }
  return input
}

function freezeEnvelope(input: ProductCredentialEnvelope): ProductCredentialEnvelope {
  return Object.freeze({
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.headers ? { headers: Object.freeze({ ...input.headers }) } : {}),
  })
}

function assertReference(reference: string) {
  if (!REFERENCE.test(reference)) throw new Error("The credential reference is invalid.")
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

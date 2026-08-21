import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { SafeStorageAdapter } from "./credentials"

const magic = Buffer.from("GUAI-CREDENTIAL-V1\0")
const keyBytes = 32
const nonceBytes = 12
const tagBytes = 16

export function createLocalCredentialStorage(filepath: string): SafeStorageAdapter {
  let cached: Buffer | undefined
  const key = () => {
    if (cached) return cached
    mkdirSync(path.dirname(filepath), { recursive: true, mode: 0o700 })
    try {
      cached = readFileSync(filepath)
    } catch (error) {
      if (!isMissing(error)) throw error
      try {
        writeFileSync(filepath, randomBytes(keyBytes), { flag: "wx", mode: 0o600 })
      } catch (cause) {
        if (!isExists(cause)) throw cause
      }
      cached = readFileSync(filepath)
    }
    if (cached.length !== keyBytes) throw new Error("The local credential key is invalid.")
    chmodSync(filepath, 0o600)
    return cached
  }

  return Object.freeze({
    isEncryptionAvailable() {
      key()
      return true
    },
    encryptString(plainText) {
      const nonce = randomBytes(nonceBytes)
      const cipher = createCipheriv("aes-256-gcm", key(), nonce)
      cipher.setAAD(magic)
      const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
      return Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted])
    },
    decryptString(encrypted) {
      if (
        encrypted.length < magic.length + nonceBytes + tagBytes ||
        !encrypted.subarray(0, magic.length).equals(magic)
      ) {
        throw new Error("The credential does not belong to the local vault.")
      }
      const nonce = encrypted.subarray(magic.length, magic.length + nonceBytes)
      const tag = encrypted.subarray(magic.length + nonceBytes, magic.length + nonceBytes + tagBytes)
      const decipher = createDecipheriv("aes-256-gcm", key(), nonce)
      decipher.setAAD(magic)
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(encrypted.subarray(magic.length + nonceBytes + tagBytes)),
        decipher.final(),
      ]).toString("utf8")
    },
  })
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

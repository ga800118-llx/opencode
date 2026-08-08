import type { Permission } from "@opencode-ai/schema/permission"
import { directoryAcceptKey, normalizeAcceptKeys, storedAcceptValue } from "./permission-auto-respond"

export function normalizePermissionMode(value: unknown): Permission.Mode | undefined {
  if (value === "restricted" || value === "standard" || value === "auto") return value
  return undefined
}

export function normalizePermissionModes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, Permission.Mode>
  return normalizeAcceptKeys(
    Object.fromEntries(
      Object.entries(value).flatMap(([key, mode]) => {
        const normalized = normalizePermissionMode(mode)
        if (!key.endsWith("/*") || !normalized) return []
        return [[key, normalized]]
      }),
    ),
  )
}

export function projectPermissionMode(modeMap: Record<string, unknown>, directory: string): Permission.Mode {
  return normalizePermissionMode(storedAcceptValue(modeMap, directoryAcceptKey(directory))) ?? "standard"
}

export function migratePermissionModes(autoAccept: Record<string, boolean>) {
  return normalizeAcceptKeys(
    Object.fromEntries(
      Object.entries(autoAccept).flatMap(([key, enabled]) => {
        if (!key.endsWith("/*") || !enabled) return []
        return [[key, "auto" as const]]
      }),
    ),
  )
}

export function taskPermissionMode(serverMode: unknown, _projectMode: Permission.Mode): Permission.Mode {
  const mode = normalizePermissionMode(serverMode)
  if (mode) return mode
  return "standard"
}

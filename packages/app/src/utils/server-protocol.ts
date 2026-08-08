import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"

const permissionModePath = "/api/session/{sessionID}/permission-mode"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function hasPermissionModeCapability(openapi: unknown) {
  if (!isRecord(openapi) || !isRecord(openapi.paths)) return false
  const path = openapi.paths[permissionModePath]
  if (!isRecord(path)) return false
  return isRecord(path.post)
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "v2"
}

export async function detectPermissionModeCapability(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  protocol: Promise<ServerProtocol> | ServerProtocol,
) {
  if ((await protocol) !== "v2") return false

  const openapi = await probe(server, fetch, "/openapi.json").catch(() => undefined)
  return hasPermissionModeCapability(openapi)
}

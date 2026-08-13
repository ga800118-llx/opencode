import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"

const permissionModePaths = {
  v1: "/session/{sessionID}/permission-mode",
  v2: "/api/session/{sessionID}/permission-mode",
} as const
const healthPath = "/api/health"

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

async function probeOpenApi(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  protocol: ServerProtocol,
) {
  if (protocol === "v1") return probe(server, fetch, "/doc").catch(() => undefined)
  return (
    (await probe(server, fetch, "/openapi.json").catch(() => undefined)) ??
    probe(server, fetch, "/doc").catch(() => undefined)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function hasPermissionModeCapability(openapi: unknown, protocol?: ServerProtocol) {
  if (!isRecord(openapi) || !isRecord(openapi.paths)) return false
  const available = openapi.paths
  const paths = protocol ? [permissionModePaths[protocol]] : Object.values(permissionModePaths)
  return paths.some((name) => {
    const path = available[name]
    return isRecord(path) && isRecord(path.post)
  })
}

export function hasV2ProtocolCapability(openapi: unknown) {
  if (!isRecord(openapi) || !isRecord(openapi.paths)) return false
  const path = openapi.paths[healthPath]
  if (!isRecord(path) || !isRecord(path.get)) return false
  return path.get.operationId === "v2.health.get"
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"
  if (current && "healthy" in current && current.healthy === true) {
    const openapi = await probeOpenApi(server, fetch, "v2")
    if (hasV2ProtocolCapability(openapi)) return "v2"
  }

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "v2"
}

export async function detectPermissionModeCapability(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  protocol: Promise<ServerProtocol> | ServerProtocol,
) {
  const kind = await protocol
  const openapi = await probeOpenApi(server, fetch, kind)
  return hasPermissionModeCapability(openapi, kind)
}

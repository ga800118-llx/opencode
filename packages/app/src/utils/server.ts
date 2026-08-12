import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  const fetch = input.fetch ?? globalThis.fetch
  const currentFetch = Object.assign(
    async (request: URL | RequestInfo, init?: RequestInit) => {
      const body = await currentPromptBody(new Request(request, init))
      if (!body) return fetch(request, init)
      return fetch(request, { ...init, body: JSON.stringify(body) })
    },
    { preconnect: fetch.preconnect },
  )
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: currentFetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

async function currentPromptBody(request: Request) {
  if (request.method !== "POST" || !/^\/api\/session\/[^/]+\/prompt$/.test(new URL(request.url).pathname)) return
  const value: unknown = await request.clone().json()
  if (!isRecord(value) || typeof value.text !== "string") return
  return {
    id: value.id,
    prompt: {
      text: value.text,
      files: Array.isArray(value.files) ? value.files.map(renameMentionToSource) : undefined,
      agents: Array.isArray(value.agents) ? value.agents.map(renameMentionToSource) : undefined,
    },
    delivery: value.delivery,
    resume: value.resume,
  }
}

function renameMentionToSource(value: unknown) {
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key === "mention" ? "source" : key, item]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export type ServerApi = OpenCodeClient

import { Location } from "@opencode-ai/schema/location"
import { Skill } from "@opencode-ai/schema/skill"
import { Schema } from "effect"

const ManagementResponse = Location.response(Schema.Array(Skill.ManagementInfo))
const decodeManagementResponse = Schema.decodeUnknownPromise(ManagementResponse)

export type SkillManagementApi = {
  list: (directory: string, options?: { refresh?: boolean }) => Promise<Skill.ManagementInfo[]>
  setEnabled: (directory: string, id: Skill.ManagementID, enabled: boolean) => Promise<Skill.ManagementInfo[]>
  remove: (directory: string, id: Skill.ManagementID) => Promise<Skill.ManagementInfo[]>
}

type SkillManagementFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type SkillManagementHeaders = HeadersInit | (() => HeadersInit | undefined)

export class SkillManagementRequestError extends Error {
  constructor(readonly status: number) {
    super(`Skill management request failed (${status})`)
    this.name = "SkillManagementRequestError"
  }
}

export function isSkillManagementNotFound(error: unknown) {
  return error instanceof SkillManagementRequestError && error.status === 404
}

export function createSkillManagementApi(input: {
  baseUrl: string
  headers?: SkillManagementHeaders
  fetch: SkillManagementFetch
}): SkillManagementApi {
  const request = async (
    method: "GET" | "PATCH" | "DELETE",
    directory: string,
    id?: Skill.ManagementID,
    enabled?: boolean,
    refresh?: boolean,
  ) => {
    const url = new URL(
      `${input.baseUrl.replace(/\/+$/, "")}/api/skill/management${id ? `/${encodeURIComponent(id)}` : ""}`,
    )
    url.searchParams.set("location[directory]", directory)
    if (refresh) url.searchParams.set("refresh", "true")
    const headers = new Headers(typeof input.headers === "function" ? input.headers() : input.headers)
    if (method === "PATCH") headers.set("Content-Type", "application/json")
    const response = await input.fetch(url, {
      method,
      headers,
      body: method === "PATCH" ? JSON.stringify({ enabled }) : undefined,
    })
    if (!response.ok) throw new SkillManagementRequestError(response.status)
    return decodeManagementResponse(await response.json()).then((result) => [...result.data])
  }

  return {
    list: (directory, options) => request("GET", directory, undefined, undefined, options?.refresh),
    setEnabled: (directory, id, enabled) => request("PATCH", directory, id, enabled),
    remove: (directory, id) => request("DELETE", directory, id),
  }
}

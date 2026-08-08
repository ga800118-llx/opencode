import { Location } from "@opencode-ai/schema/location"
import { Skill } from "@opencode-ai/schema/skill"
import { Schema } from "effect"

const ManagementResponse = Location.response(Schema.Array(Skill.ManagementInfo))
const decodeManagementResponse = Schema.decodeUnknownPromise(ManagementResponse)

export type SkillManagementApi = {
  list: (directory: string) => Promise<Skill.ManagementInfo[]>
  setEnabled: (directory: string, id: Skill.ManagementID, enabled: boolean) => Promise<Skill.ManagementInfo[]>
  remove: (directory: string, id: Skill.ManagementID) => Promise<Skill.ManagementInfo[]>
}

type SkillManagementFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class SkillManagementRequestError extends Error {
  constructor(readonly status: number) {
    super(`Skill management request failed (${status})`)
    this.name = "SkillManagementRequestError"
  }
}

export function createSkillManagementApi(input: {
  baseUrl: string
  headers?: HeadersInit
  fetch?: SkillManagementFetch
}): SkillManagementApi {
  const fetcher = input.fetch ?? globalThis.fetch
  const request = async (
    method: "GET" | "PATCH" | "DELETE",
    directory: string,
    id?: Skill.ManagementID,
    enabled?: boolean,
  ) => {
    const url = new URL(
      `${input.baseUrl.replace(/\/+$/, "")}/api/skill/management${id ? `/${encodeURIComponent(id)}` : ""}`,
    )
    url.searchParams.set("location[directory]", directory)
    const headers = new Headers(input.headers)
    if (method === "PATCH") headers.set("Content-Type", "application/json")
    const response = await fetcher(url, {
      method,
      headers,
      body: method === "PATCH" ? JSON.stringify({ enabled }) : undefined,
    })
    if (!response.ok) throw new SkillManagementRequestError(response.status)
    return decodeManagementResponse(await response.json()).then((result) => [...result.data])
  }

  return {
    list: (directory) => request("GET", directory),
    setEnabled: (directory, id, enabled) => request("PATCH", directory, id, enabled),
    remove: (directory, id) => request("DELETE", directory, id),
  }
}

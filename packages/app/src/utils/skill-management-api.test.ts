import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import {
  createSkillManagementApi,
  isSkillManagementNotFound,
  SkillManagementRequestError,
} from "./skill-management-api"

const id = Schema.decodeUnknownSync(Skill.ManagementID)("skill/id with spaces")
const response = {
  location: {
    directory: "/repo",
    project: { id: "project-id", directory: "/repo" },
  },
  data: [
    {
      id: "skill-id",
      name: "deploy",
      description: "Deploy a release",
      location: "/repo/.opencode/skills/deploy/SKILL.md",
      source: { type: "directory", scope: "project", value: "/repo/.opencode/skills" },
      status: "active",
      enabled: true,
      deletable: true,
      deleteTarget: "/repo/.opencode/skills/deploy",
    },
  ],
}

describe("Skill management API", () => {
  test("uses exact management routes, deep-object location query, auth, and JSON body", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = async (value: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: value.toString(), init })
      return Response.json(response)
    }
    const api = createSkillManagementApi({
      baseUrl: "https://server.example/",
      headers: { Authorization: "Basic dXNlcjpwYXNz", "X-Client": "desktop" },
      fetch: fetcher,
    })

    expect((await api.list("/repo with space"))[0]?.name).toBe("deploy")
    await api.setEnabled("/repo with space", id, false)
    await api.remove("/repo with space", id)

    expect(requests.map((item) => item.url)).toEqual([
      "https://server.example/api/skill/management?location%5Bdirectory%5D=%2Frepo+with+space",
      "https://server.example/api/skill/management/skill%2Fid%20with%20spaces?location%5Bdirectory%5D=%2Frepo+with+space",
      "https://server.example/api/skill/management/skill%2Fid%20with%20spaces?location%5Bdirectory%5D=%2Frepo+with+space",
    ])
    expect(requests.map((item) => item.init?.method)).toEqual(["GET", "PATCH", "DELETE"])
    expect(requests[1]?.init?.body).toBe('{"enabled":false}')
    requests.forEach((item) => {
      const headers = new Headers(item.init?.headers)
      expect(headers.get("Authorization")).toBe("Basic dXNlcjpwYXNz")
      expect(headers.get("X-Client")).toBe("desktop")
    })
    expect(new Headers(requests[1]?.init?.headers).get("Content-Type")).toBe("application/json")
  })

  test("throws a stable safe error for non-success responses", async () => {
    const api = createSkillManagementApi({
      baseUrl: "https://server.example",
      fetch: async () => new Response('secret content from /Users/test/private/SKILL.md', { status: 500 }),
    })

    const error = await api.list("/Users/test/private").catch((value: unknown) => value)
    expect(error).toBeInstanceOf(SkillManagementRequestError)
    expect((error as Error).message).toBe("Skill management request failed (500)")
    expect((error as Error).message).not.toContain("secret")
    expect((error as Error).message).not.toContain("/Users/test")
  })

  test("classifies only management 404 responses as missing installations", () => {
    expect(isSkillManagementNotFound(new SkillManagementRequestError(404))).toBe(true)
    expect(isSkillManagementNotFound(new SkillManagementRequestError(500))).toBe(false)
    expect(isSkillManagementNotFound(new Error("404"))).toBe(false)
  })

  test("reads authenticated headers for every request", async () => {
    const authorizations: Array<string | null> = []
    const credentials = { authorization: "Basic Zmlyc3Q6cGFzcw==" }
    const api = createSkillManagementApi({
      baseUrl: "https://server.example",
      headers: () => ({ Authorization: credentials.authorization }),
      fetch: async (_input, init) => {
        authorizations.push(new Headers(init?.headers).get("Authorization"))
        return Response.json(response)
      },
    })

    await api.list("/repo")
    credentials.authorization = "Basic c2Vjb25kOnBhc3M="
    await api.list("/repo")

    expect(authorizations).toEqual(["Basic Zmlyc3Q6cGFzcw==", "Basic c2Vjb25kOnBhc3M="])
  })
})

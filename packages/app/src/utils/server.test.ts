import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("createApiForServer", () => {
  test("adapts the vendored prompt request to the current V2 protocol", async () => {
    const requests: Request[] = []
    const api = createApiForServer({
      server: { url: "http://localhost:4096", password: "secret" },
      fetch: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = new Request(input, init)
          requests.push(request)
          return Response.json({
            data: {
              admittedSeq: 1,
              id: "msg_1",
              sessionID: "ses_1",
              prompt: { text: "Inspect this" },
              delivery: "steer",
              timeCreated: 1,
            },
          })
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    })

    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "Inspect this",
      files: [
        {
          uri: "file:///repo/a.ts",
          name: "a.ts",
          mention: { text: "@a.ts", start: 8, end: 13 },
        },
      ],
      agents: [{ name: "build", mention: { text: "@build", start: 14, end: 20 } }],
      delivery: "queue",
      resume: false,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.headers.get("authorization")).toBe(`Basic ${btoa("opencode:secret")}`)
    expect(await requests[0]!.json()).toEqual({
      id: "msg_1",
      prompt: {
        text: "Inspect this",
        files: [
          {
            uri: "file:///repo/a.ts",
            name: "a.ts",
            source: { text: "@a.ts", start: 8, end: 13 },
          },
        ],
        agents: [{ name: "build", source: { text: "@build", start: 14, end: 20 } }],
      },
      delivery: "queue",
      resume: false,
    })
  })
})

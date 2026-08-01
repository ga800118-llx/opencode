import { describe, expect, test } from "bun:test"
import { startMockModelServer } from "./mock-openai-server.fixture.test"

describe("mock model server", () => {
  test("serves deterministic authenticated model, stream, and tool routes", async () => {
    const server = startMockModelServer()
    const headers = { Authorization: "Bearer fixture-secret", "X-Private-Token": "fixture-private-header" }
    try {
      const models = await fetch(`${server.baseURL}/models`, { headers }).then((response) => response.json())
      expect(models).toEqual({ data: [{ id: "coder" }, { id: "reasoner", name: "Reasoner" }] })
      const unauthorized = await fetch(`${server.baseURL}/models`)
      expect(unauthorized.status).toBe(401)
    } finally {
      server.stop()
    }
  })
})

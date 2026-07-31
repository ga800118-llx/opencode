import { describe, expect, test } from "bun:test"
import { normalizeProductDeepLinks } from "./deep-link"
import { getProductIdentity } from "./identity"

describe("desktop product deep links", () => {
  test("normalizes development links for the shared app", () => {
    expect(
      normalizeProductDeepLinks(getProductIdentity("dev"), [
        "agent-desktop-dev://open-project?directory=/tmp/demo",
        "agent-desktop-dev://new-session?directory=/tmp/demo&prompt=ship%20it",
      ]),
    ).toEqual([
      "opencode://open-project?directory=/tmp/demo",
      "opencode://new-session?directory=/tmp/demo&prompt=ship%20it",
    ])
  })

  test("drops malformed and non-current schemes", () => {
    expect(
      normalizeProductDeepLinks(getProductIdentity("dev"), [
        "opencode://open-project?directory=/release",
        "https://opencode.ai",
        "agent-desktop-dev:open-project",
        "AGENT-DESKTOP-DEV://open-project?directory=/uppercase",
        "agent-desktop-development://open-project?directory=/prefix",
        "agent-desktop-dev://%",
        "not a url",
      ]),
    ).toEqual([])
  })

  for (const channel of ["beta", "prod"] as const) {
    test(`preserves ${channel} OpenCode links`, () => {
      const input = "opencode://open-project?directory=/tmp/demo"
      expect(normalizeProductDeepLinks(getProductIdentity(channel), [input])).toEqual([input])
    })
  }
})

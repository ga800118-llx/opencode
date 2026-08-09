import { describe, expect, test } from "bun:test"
import { normalizeProductDeepLinks } from "./deep-link"
import { getProductIdentity } from "./identity"

describe("desktop product deep links", () => {
  test("normalizes development links for the shared app", () => {
    expect(
      normalizeProductDeepLinks(getProductIdentity("dev"), [
        "guai-code-dev://open-project?directory=/tmp/demo",
        "guai-code-dev://new-session?directory=/tmp/demo&prompt=ship%20it",
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
        "guai-code-dev:open-project",
        "GUAI-CODE-DEV://open-project?directory=/uppercase",
        "guai-code-development://open-project?directory=/prefix",
        "guai-code-dev://%",
        "not a url",
      ]),
    ).toEqual([])
  })

  test("normalizes beta links to the internal compatibility scheme", () => {
    expect(
      normalizeProductDeepLinks(getProductIdentity("beta"), [
        "guai-code-beta://open-project?directory=/tmp/demo",
      ]),
    ).toEqual(["opencode://open-project?directory=/tmp/demo"])
  })

  test("normalizes production links to the internal compatibility scheme", () => {
    expect(
      normalizeProductDeepLinks(getProductIdentity("prod"), ["guai-code://open-project?directory=/tmp/demo"]),
    ).toEqual(["opencode://open-project?directory=/tmp/demo"])
  })
})

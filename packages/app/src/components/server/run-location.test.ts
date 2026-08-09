import { describe, expect, test } from "bun:test"
import { runLocationName } from "./run-location"

describe("runLocationName", () => {
  test("uses the product-facing local name for the built-in sidecar", () => {
    expect(
      runLocationName(
        {
          type: "sidecar",
          variant: "base",
          http: { url: "http://127.0.0.1:4096" },
          displayName: "Local Server",
        },
        "本机",
      ),
    ).toBe("本机")
  })

  test("keeps a remote computer's configured name", () => {
    expect(
      runLocationName(
        {
          type: "http",
          http: { url: "https://agent.example.com" },
          displayName: "Office computer",
        },
        "This device",
      ),
    ).toBe("Office computer")
  })
})

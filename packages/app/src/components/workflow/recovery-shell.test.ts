import { describe, expect, test } from "bun:test"
import { recoveryShellSelection } from "./recovery-shell"

describe("recoveryShellSelection", () => {
  test("selects both desktop layouts through one shared recovery boundary", () => {
    const legacy = recoveryShellSelection(false)
    const current = recoveryShellSelection(true)

    expect(legacy).toEqual({ boundary: "app-interface", layout: "legacy" })
    expect(current).toEqual({ boundary: "app-interface", layout: "new" })
    expect(new Set([legacy.boundary, current.boundary])).toHaveLength(1)
  })
})

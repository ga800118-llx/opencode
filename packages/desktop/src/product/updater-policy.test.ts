import { describe, expect, test } from "bun:test"
import { productUpdaterEnabled } from "./updater-policy"

describe("product updater policy", () => {
  test("keeps development and internal beta builds isolated from release feeds", () => {
    expect(productUpdaterEnabled({ packaged: true, channel: "dev", explicitlyEnabled: true })).toBe(false)
    expect(productUpdaterEnabled({ packaged: true, channel: "beta", explicitlyEnabled: true })).toBe(false)
  })

  test("requires an explicit opt-in on packaged production builds", () => {
    expect(productUpdaterEnabled({ packaged: true, channel: "prod", explicitlyEnabled: false })).toBe(false)
    expect(productUpdaterEnabled({ packaged: false, channel: "prod", explicitlyEnabled: true })).toBe(false)
    expect(productUpdaterEnabled({ packaged: true, channel: "prod", explicitlyEnabled: true })).toBe(true)
  })
})

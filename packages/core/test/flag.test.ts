import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "../src/flag/flag"

const original = process.env.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL

afterEach(() => {
  if (original === undefined) {
    delete process.env.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL
    return
  }
  process.env.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL = original
})

describe("Flag.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL", () => {
  test("reads the desktop-only environment switch at access time", () => {
    delete process.env.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL
    expect(Flag.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL).toBe(false)

    process.env.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "1"
    expect(Flag.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL).toBe(true)
  })
})

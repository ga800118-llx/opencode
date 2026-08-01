import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { resolveDesktopUserDataPath } from "./user-data"

describe("resolveDesktopUserDataPath", () => {
  test("uses the product namespace by default", () => {
    expect(
      resolveDesktopUserDataPath({ appDataPath: "/Users/test/Library/Application Support", dataNamespace: "dev.agent" }),
    ).toBe("/Users/test/Library/Application Support/dev.agent")
  })

  test("respects Electron's user-data-dir override", () => {
    expect(
      resolveDesktopUserDataPath({
        appDataPath: "/ignored",
        dataNamespace: "dev.agent",
        commandLineOverride: " ./isolated-desktop ",
      }),
    ).toBe(resolve("./isolated-desktop"))
  })

  test("keeps onboarding test isolation authoritative", () => {
    expect(
      resolveDesktopUserDataPath({
        appDataPath: "/ignored",
        dataNamespace: "dev.agent",
        commandLineOverride: "/also-ignored",
        onboardingRoot: "/tmp/onboarding",
      }),
    ).toBe("/tmp/onboarding/desktop")
  })
})

import { describe, expect, test } from "bun:test"
import path from "node:path"
import { assertInternalMacHost, createInternalMacArtifactPlan, formatChecksumManifest } from "./package-internal-mac"

describe("internal Mac package", () => {
  test("plans versioned Apple Silicon artifacts", () => {
    const plan = createInternalMacArtifactPlan("/repo/packages/desktop", "0.1.0-alpha.1", "arm64")

    expect(plan.app).toBe("/repo/packages/desktop/dist/mac-arm64/Guai Code Beta.app")
    expect(plan.builderDmg).toBe(
      "/repo/packages/desktop/dist/guai-code-desktop-beta-0.1.0-alpha.1-mac-arm64.dmg",
    )
    expect(plan.builderZip).toBe(
      "/repo/packages/desktop/dist/guai-code-desktop-beta-0.1.0-alpha.1-mac-arm64.zip",
    )
    expect(plan.directory).toBe("/repo/packages/desktop/dist/internal-beta/0.1.0-alpha.1")
    expect(path.basename(plan.dmg)).toBe("Guai-Code-Beta-0.1.0-alpha.1-mac-arm64.dmg")
    expect(path.basename(plan.zip)).toBe("Guai-Code-Beta-0.1.0-alpha.1-mac-arm64.zip")
  })

  test("rejects unsupported package hosts", () => {
    expect(() => assertInternalMacHost("darwin", "arm64")).not.toThrow()
    expect(() => assertInternalMacHost("darwin", "x64")).toThrow("Apple Silicon")
    expect(() => assertInternalMacHost("win32", "arm64")).toThrow("macOS")
  })

  test("formats a stable checksum manifest", () => {
    expect(
      formatChecksumManifest([
        { file: "/tmp/Guai-Code-Beta.zip", sha256: "b".repeat(64) },
        { file: "/tmp/Guai-Code-Beta.dmg", sha256: "a".repeat(64) },
      ]),
    ).toBe(`${"a".repeat(64)}  Guai-Code-Beta.dmg\n${"b".repeat(64)}  Guai-Code-Beta.zip\n`)
  })
})

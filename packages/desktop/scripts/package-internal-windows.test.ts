import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest, sha256 } from "./internal-package"
import {
  assertInternalWindowsHost,
  assertMinGitChecksum,
  assertMinGitContentLength,
  assertMinGitSize,
  createInternalWindowsArtifactPlan,
  createPortableZipCommand,
  createPortableZipVerificationCommand,
  MINGIT_ASSET,
  MINGIT_DOWNLOAD_TIMEOUT_MS,
  MINGIT_RELEASE,
  MINGIT_SHA256,
  MINGIT_SIZE_BYTES,
  MINGIT_URL,
  PORTABLE_ZIP_REQUIRED_ENTRIES,
  withDownloadTemporaryFile,
} from "./package-internal-windows"

describe("internal Windows package", () => {
  test("uses the Windows internal Beta package metadata", () => {
    expect(pkg.version).toBe("0.1.0-alpha.2")
    expect(pkg.description).toBeTruthy()
    expect(pkg.scripts["package:win:internal"]).toBe("bun ./scripts/package-internal-windows.ts")
  })

  test("rejects unsupported package hosts", () => {
    expect(() => assertInternalWindowsHost("win32", "x64")).not.toThrow()
    expect(() => assertInternalWindowsHost("win32", "arm64")).toThrow("x64")
    expect(() => assertInternalWindowsHost("darwin", "x64")).toThrow("Windows")
  })

  test("plans versioned Windows x64 artifacts", () => {
    const packageDir = path.join(path.parse(process.cwd()).root, "repo", "packages", "desktop")
    const plan = createInternalWindowsArtifactPlan(packageDir, "0.1.0-alpha.2")

    expect(plan.builderInstaller).toBe(
      path.join(packageDir, "dist", "guai-code-desktop-beta-0.1.0-alpha.2-win-x64.exe"),
    )
    expect(plan.unpacked).toBe(path.join(packageDir, "dist", "win-unpacked"))
    expect(plan.staging).toBe(path.join(packageDir, "dist", "internal-resources", "mingit"))
    expect(plan.directory).toBe(
      path.join(packageDir, "dist", "internal-beta", "0.1.0-alpha.2", "windows-x64"),
    )
    expect(path.basename(plan.installer)).toBe("Guai-Code-Beta-0.1.0-alpha.2-win-x64.exe")
    expect(path.basename(plan.portableZip)).toBe("Guai-Code-Beta-0.1.0-alpha.2-win-x64-portable.zip")
    expect(path.basename(plan.checksums)).toBe("SHA256SUMS.txt")
    expect(path.basename(plan.guide)).toBe("Guai-Code-Beta-Windows-试用说明.md")
    expect(path.basename(plan.openCodeLicense)).toBe("OpenCode-MIT-License.txt")
    expect(path.basename(plan.gitLicense)).toBe("Git-for-Windows-License.txt")
  })

  test("pins the official MinGit release", () => {
    expect(MINGIT_RELEASE).toBe("v2.55.0.windows.3")
    expect(MINGIT_ASSET).toBe("MinGit-2.55.0.3-64-bit.zip")
    expect(MINGIT_URL).toBe(
      "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/MinGit-2.55.0.3-64-bit.zip",
    )
    expect(MINGIT_SHA256).toBe("f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05")
    expect(MINGIT_SIZE_BYTES).toBe(38_791_206)
    expect(MINGIT_DOWNLOAD_TIMEOUT_MS).toBe(120_000)
  })

  test("fails closed on MinGit response and archive metadata", () => {
    expect(() => assertMinGitContentLength(String(MINGIT_SIZE_BYTES))).not.toThrow()
    expect(() => assertMinGitSize(MINGIT_SIZE_BYTES)).not.toThrow()
    expect(() => assertMinGitChecksum(MINGIT_SHA256)).not.toThrow()

    expect(() => assertMinGitContentLength(null)).toThrow("Content-Length")
    expect(() => assertMinGitContentLength(String(MINGIT_SIZE_BYTES - 1))).toThrow("Content-Length")
    expect(() => assertMinGitSize(MINGIT_SIZE_BYTES + 1)).toThrow("size mismatch")
    expect(() => assertMinGitChecksum("0".repeat(64))).toThrow("checksum mismatch")
  })

  test("always removes the current download temporary file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mingit-download-"))
    const temporary = path.join(directory, "MinGit.zip.download")

    await expect(
      withDownloadTemporaryFile(temporary, async () => {
        await Bun.write(temporary, "partial")
        throw new Error("write failed")
      }),
    ).rejects.toThrow("write failed")
    expect(await Bun.file(temporary).exists()).toBeFalse()

    await rm(directory, { recursive: true, force: true })
  })

  test("creates and verifies portable ZIPs with .NET ZipFile", () => {
    const create = createPortableZipCommand("C:\\build's\\win-unpacked", "C:\\delivery\\portable.zip")
    const verify = createPortableZipVerificationCommand("C:\\delivery\\portable.zip")

    expect(create).toContain("[System.IO.Compression.ZipFile]::CreateFromDirectory")
    expect(create).toContain("'C:\\build''s\\win-unpacked'")
    expect(create).toContain("$false")
    expect(create).not.toContain("Compress-Archive")
    expect(verify).toContain("[System.IO.Compression.ZipFile]::OpenRead")
    expect(verify).toContain("$archive.Dispose()")
    expect(PORTABLE_ZIP_REQUIRED_ENTRIES).toEqual([
      "Guai Code Beta.exe",
      "resources/mingit/cmd/git.exe",
      "resources/mingit/LICENSE.txt",
      "resources/licenses/OpenCode-MIT.txt",
    ])
    expect(PORTABLE_ZIP_REQUIRED_ENTRIES.every((entry) => verify.includes(entry))).toBeTrue()
  })

  test("hashes files and formats stable checksum manifests", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-package-"))
    const first = path.join(directory, "Guai-Code-Beta.exe")
    const second = path.join(directory, "Guai-Code-Beta.zip")
    await Promise.all([Bun.write(first, "beta"), Bun.write(second, "portable")])

    expect(await sha256(first)).toBe("f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753")
    expect(
      formatChecksumManifest([
        { file: second, sha256: "b".repeat(64) },
        { file: first, sha256: "a".repeat(64) },
      ]),
    ).toBe(`${"a".repeat(64)}  Guai-Code-Beta.exe\n${"b".repeat(64)}  Guai-Code-Beta.zip\n`)

    await rm(directory, { recursive: true, force: true })
  })
})

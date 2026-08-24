import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest, sha256 } from "./internal-package"
import {
  assertInternalWindowsHost,
  assertMinGitChecksum,
  assertMinGitSize,
  createDesktopBuildCommands,
  createMinGitDownloadCommand,
  createInternalWindowsArtifactPlan,
  createPortableZipCommand,
  createPortableZipVerificationCommand,
  MINGIT_ASSET,
  MINGIT_DOWNLOAD_ATTEMPTS,
  MINGIT_DOWNLOAD_RETRY_DELAY_MS,
  MINGIT_DOWNLOAD_TIMEOUT_MS,
  MINGIT_RELEASE,
  MINGIT_SHA256,
  MINGIT_SIZE_BYTES,
  MINGIT_URL,
  PORTABLE_ZIP_REQUIRED_ENTRIES,
  runDownloadAttempts,
  runProcessWithHardTimeout,
  withDownloadTemporaryFile,
} from "./package-internal-windows"

const guidePath = path.join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "docs",
  "product",
  "internal-beta-testing-windows.md",
)

describe("internal Windows package", () => {
  test("uses the Windows internal Beta package metadata", () => {
    expect(pkg.version).toBe("0.1.0-alpha.6")
    expect(pkg.description).toBeTruthy()
    expect(pkg.scripts["package:win:internal"]).toBe("bun ./scripts/package-internal-windows.ts")
  })

  test("identifies Alpha 6 artifacts and states the Windows testing and SmartScreen constraints", async () => {
    const guide = await Bun.file(guidePath).text()

    expect(guide).toContain("版本：`0.1.0-alpha.6`")
    expect(guide).toContain("Guai-Code-Beta-0.1.0-alpha.6-win-x64.exe")
    expect(guide).toContain("Guai-Code-Beta-0.1.0-alpha.6-win-x64-portable.zip")
    expect(guide).not.toContain("alpha.2")
    expect(guide).not.toContain("Windows SmartScreen 会显示风险提示")
    expect(guide).not.toContain("SmartScreen 显示“Windows 已保护你的电脑”时")
    expect(guide).not.toContain("再点击“仍要运行”")
    expect(guide).not.toContain("仅验证 Windows 11 x64")
    expect(guide).not.toContain("SmartScreen 放行仅适用于")
    expect(guide).toContain("目标测试系统：Windows 11 x64")
    expect(guide).toContain("GitHub Windows Server 2025 x64")
    expect(guide).toContain("Windows 11 实机安装和界面验证仍待完成")
    expect(guide).toContain("可能触发 SmartScreen")
    expect(guide).toContain("文件信誉、下载来源和系统或组织策略")
    expect(guide).toContain("如果 SmartScreen 出现")
    expect(guide).toContain("如果“仍要运行”（`Run anyway`）可用")
    expect(guide).toContain("停止安装并联系维护者")
    expect(guide).toContain("受管理设备的组织策略可能不提供“仍要运行”选项")
    expect(guide).toContain("不要绕过组织安全策略")
  })

  test("rejects unsupported package hosts", () => {
    expect(() => assertInternalWindowsHost("win32", "x64")).not.toThrow()
    expect(() => assertInternalWindowsHost("win32", "arm64")).toThrow("x64")
    expect(() => assertInternalWindowsHost("darwin", "x64")).toThrow("Windows")
  })

  test("plans versioned Windows x64 artifacts", () => {
    const packageDir = path.join(path.parse(process.cwd()).root, "repo", "packages", "desktop")
    const plan = createInternalWindowsArtifactPlan(packageDir, "0.1.0-alpha.3")

    expect(plan.builderInstaller).toBe(
      path.join(packageDir, "dist", "guai-code-desktop-beta-0.1.0-alpha.3-win-x64.exe"),
    )
    expect(plan.unpacked).toBe(path.join(packageDir, "dist", "win-unpacked"))
    expect(plan.staging).toBe(path.join(packageDir, "dist", "internal-resources", "mingit"))
    expect(plan.directory).toBe(
      path.join(packageDir, "dist", "internal-beta", "0.1.0-alpha.3", "windows-x64"),
    )
    expect(path.basename(plan.installer)).toBe("Guai-Code-Beta-0.1.0-alpha.3-win-x64.exe")
    expect(path.basename(plan.portableZip)).toBe("Guai-Code-Beta-0.1.0-alpha.3-win-x64-portable.zip")
    expect(path.basename(plan.checksums)).toBe("SHA256SUMS.txt")
    expect(path.basename(plan.guide)).toBe("Guai-Code-Beta-Windows-试用说明.md")
    expect(path.basename(plan.openCodeLicense)).toBe("OpenCode-MIT-License.txt")
    expect(path.basename(plan.gitLicense)).toBe("Git-for-Windows-License.txt")
  })

  test("runs installed desktop build tools through Bun without assuming a node_modules layout", () => {
    expect(createDesktopBuildCommands()).toEqual([
      ["bun", "run", "electron-vite", "build"],
      [
        "bun",
        "run",
        "electron-builder",
        "--win",
        "--x64",
        "--publish",
        "never",
        "--config",
        "electron-builder.config.ts",
      ],
    ])
    expect(createDesktopBuildCommands().flat()).not.toContain("bunx")
    expect(createDesktopBuildCommands().flat().some((part) => part.includes("node_modules"))).toBeFalse()
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
    expect(MINGIT_DOWNLOAD_ATTEMPTS).toBe(3)
    expect(MINGIT_DOWNLOAD_RETRY_DELAY_MS).toBe(5_000)
  })

  test("fails closed on MinGit archive metadata", () => {
    expect(() => assertMinGitSize(MINGIT_SIZE_BYTES)).not.toThrow()
    expect(() => assertMinGitChecksum(MINGIT_SHA256)).not.toThrow()

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

  test("downloads MinGit with curl.exe and visible transfer progress", () => {
    const temporary = path.join("C:\\cache", `${MINGIT_ASSET}.download`)

    expect(createMinGitDownloadCommand(temporary)).toEqual([
      "curl.exe",
      "--fail",
      "--location",
      "--show-error",
      "--progress-bar",
      "--connect-timeout",
      "30",
      "--output",
      temporary,
      MINGIT_URL,
    ])
  })

  test("gives the download process a native hard timeout and force-kill signal", async () => {
    const command = ["curl.exe", MINGIT_URL]
    let spawnedCommand: string[] | undefined
    let spawnedOptions: Record<string, unknown> | undefined

    await runProcessWithHardTimeout(command, 120_000, (input, options) => {
      spawnedCommand = input
      spawnedOptions = options
      return { exited: Promise.resolve(0) }
    })

    expect(spawnedCommand).toEqual(command)
    expect(spawnedOptions).toEqual({
      stdout: "inherit",
      stderr: "inherit",
      timeout: 120_000,
      killSignal: "SIGKILL",
    })
  })

  test("retries a bounded number of times, logs each stage, and removes partial downloads", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mingit-retry-"))
    const temporary = path.join(directory, `${MINGIT_ASSET}.download`)
    const logs: string[] = []
    const delays: number[] = []
    const observedPartialFiles: boolean[] = []

    await expect(
      runDownloadAttempts({
        temporary,
        attempts: MINGIT_DOWNLOAD_ATTEMPTS,
        retryDelayMs: MINGIT_DOWNLOAD_RETRY_DELAY_MS,
        log: (message) => logs.push(message),
        delay: async (milliseconds) => {
          delays.push(milliseconds)
        },
        run: async (attempt) => {
          observedPartialFiles.push(await Bun.file(temporary).exists())
          await Bun.write(temporary, `partial-${attempt}`)
          throw new Error(`network-${attempt}`)
        },
      }),
    ).rejects.toThrow("failed after 3 attempts")

    expect(observedPartialFiles).toEqual([false, false, false])
    expect(delays).toEqual([MINGIT_DOWNLOAD_RETRY_DELAY_MS, MINGIT_DOWNLOAD_RETRY_DELAY_MS])
    expect(await Bun.file(temporary).exists()).toBeFalse()
    expect(logs).toEqual([
      `[MinGit] Download attempt 1/${MINGIT_DOWNLOAD_ATTEMPTS}`,
      `[MinGit] Download attempt 1/${MINGIT_DOWNLOAD_ATTEMPTS} failed: network-1`,
      `[MinGit] Retrying in ${MINGIT_DOWNLOAD_RETRY_DELAY_MS} ms`,
      `[MinGit] Download attempt 2/${MINGIT_DOWNLOAD_ATTEMPTS}`,
      `[MinGit] Download attempt 2/${MINGIT_DOWNLOAD_ATTEMPTS} failed: network-2`,
      `[MinGit] Retrying in ${MINGIT_DOWNLOAD_RETRY_DELAY_MS} ms`,
      `[MinGit] Download attempt 3/${MINGIT_DOWNLOAD_ATTEMPTS}`,
      `[MinGit] Download attempt 3/${MINGIT_DOWNLOAD_ATTEMPTS} failed: network-3`,
    ])

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

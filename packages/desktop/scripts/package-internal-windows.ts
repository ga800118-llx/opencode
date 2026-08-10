#!/usr/bin/env bun

import { $ } from "bun"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest, sha256 } from "./internal-package"

export const MINGIT_RELEASE = "v2.55.0.windows.3"
export const MINGIT_ASSET = "MinGit-2.55.0.3-64-bit.zip"
export const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/${MINGIT_RELEASE}/${MINGIT_ASSET}`
export const MINGIT_SHA256 = "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05"
export const MINGIT_SIZE_BYTES = 38_791_206
export const MINGIT_DOWNLOAD_TIMEOUT_MS = 120_000
export const MINGIT_DOWNLOAD_ATTEMPTS = 3
export const MINGIT_DOWNLOAD_RETRY_DELAY_MS = 5_000
export const PORTABLE_ZIP_REQUIRED_ENTRIES = [
  "Guai Code Beta.exe",
  "resources/mingit/cmd/git.exe",
  "resources/mingit/LICENSE.txt",
  "resources/licenses/OpenCode-MIT.txt",
] as const

export function assertInternalWindowsHost(platform: NodeJS.Platform, arch: string) {
  if (platform !== "win32") throw new Error("The internal Windows package must be built on Windows.")
  if (arch !== "x64") throw new Error("This internal Windows package currently supports x64 only.")
}

export function createInternalWindowsArtifactPlan(packageDir: string, version: string) {
  const dist = path.join(packageDir, "dist")
  const deliveryStem = `Guai-Code-Beta-${version}-win-x64`
  const directory = path.join(dist, "internal-beta", version, "windows-x64")
  return {
    builderInstaller: path.join(dist, `guai-code-desktop-beta-${version}-win-x64.exe`),
    unpacked: path.join(dist, "win-unpacked"),
    staging: path.join(dist, "internal-resources", "mingit"),
    directory,
    installer: path.join(directory, `${deliveryStem}.exe`),
    portableZip: path.join(directory, `${deliveryStem}-portable.zip`),
    checksums: path.join(directory, "SHA256SUMS.txt"),
    guide: path.join(directory, "Guai-Code-Beta-Windows-试用说明.md"),
    openCodeLicense: path.join(directory, "OpenCode-MIT-License.txt"),
    gitLicense: path.join(directory, "Git-for-Windows-License.txt"),
  }
}

export function createDesktopBuildCommands() {
  return [
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
  ]
}

export function assertMinGitSize(size: number) {
  if (size === MINGIT_SIZE_BYTES) return
  throw new Error(`MinGit size mismatch: expected ${MINGIT_SIZE_BYTES}, received ${size}`)
}

export function assertMinGitChecksum(checksum: string) {
  if (checksum === MINGIT_SHA256) return
  throw new Error(`MinGit checksum mismatch: expected ${MINGIT_SHA256}, received ${checksum}`)
}

export async function withDownloadTemporaryFile<T>(temporary: string, action: () => Promise<T>) {
  try {
    return await action()
  } finally {
    await rm(temporary, { force: true })
  }
}

export function createMinGitDownloadCommand(temporary: string) {
  return [
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
  ]
}

type DownloadProcess = {
  exited: Promise<number>
}

type DownloadProcessOptions = {
  stdout: "inherit"
  stderr: "inherit"
  timeout: number
  killSignal: "SIGKILL"
}

export async function runProcessWithHardTimeout(
  command: string[],
  timeoutMs: number,
  spawn: (command: string[], options: DownloadProcessOptions) => DownloadProcess = (input, options) =>
    Bun.spawn(input, options),
) {
  const exitCode = await spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  }).exited
  if (exitCode !== 0) throw new Error(`Download process failed with exit code ${exitCode}`)
}

export async function runDownloadAttempts(options: {
  temporary: string
  attempts: number
  retryDelayMs: number
  run: (attempt: number) => Promise<void>
  log?: (message: string) => void
  delay?: (milliseconds: number) => Promise<void>
}) {
  const log = options.log ?? console.log
  const delay =
    options.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  const attempt = async (current: number): Promise<void> => {
    await rm(options.temporary, { force: true })
    log(`[MinGit] Download attempt ${current}/${options.attempts}`)
    const result = await options.run(current).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    )
    if (result.success) return

    await rm(options.temporary, { force: true })
    const message = result.error instanceof Error ? result.error.message : String(result.error)
    log(`[MinGit] Download attempt ${current}/${options.attempts} failed: ${message}`)
    if (current >= options.attempts) {
      throw new Error(`MinGit download failed after ${options.attempts} attempts: ${message}`, {
        cause: result.error,
      })
    }

    log(`[MinGit] Retrying in ${options.retryDelayMs} ms`)
    await delay(options.retryDelayMs)
    return attempt(current + 1)
  }

  return attempt(1)
}

export function createPortableZipCommand(source: string, destination: string) {
  return `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quotePowerShell(source)}, ${quotePowerShell(destination)}, [System.IO.Compression.CompressionLevel]::Optimal, $false)`
}

export function createPortableZipVerificationCommand(file: string) {
  const required = PORTABLE_ZIP_REQUIRED_ENTRIES.map(quotePowerShell).join(", ")
  return `Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShell(file)}); try { $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\\', '/') }); $required = @(${required}); $missing = @($required | Where-Object { $entries -notcontains $_ }); if ($missing.Count -gt 0) { throw "Portable ZIP missing required entries: $($missing -join ', ')" } } finally { $archive.Dispose() }`
}

async function downloadMinGit() {
  const directory = path.join(homedir(), ".cache", "guai-code", "internal-package")
  const archive = path.join(directory, MINGIT_ASSET)
  await mkdir(directory, { recursive: true })

  console.log(`[MinGit] Checking cache: ${archive}`)
  if (await Bun.file(archive).exists()) {
    if ((await stat(archive)).size === MINGIT_SIZE_BYTES && (await sha256(archive)) === MINGIT_SHA256) {
      console.log("[MinGit] Using verified cached archive")
      return archive
    }
    console.log("[MinGit] Cached archive is invalid; removing it")
    await rm(archive, { force: true })
  }

  const temporary = `${archive}.${process.pid}-${randomUUID()}.download`
  return withDownloadTemporaryFile(temporary, async () => {
    console.log(`[MinGit] Cache miss; downloading ${MINGIT_URL}`)
    await runDownloadAttempts({
      temporary,
      attempts: MINGIT_DOWNLOAD_ATTEMPTS,
      retryDelayMs: MINGIT_DOWNLOAD_RETRY_DELAY_MS,
      run: async () => {
        await runProcessWithHardTimeout(createMinGitDownloadCommand(temporary), MINGIT_DOWNLOAD_TIMEOUT_MS)
        console.log("[MinGit] Validating downloaded archive size")
        assertMinGitSize((await stat(temporary)).size)
        console.log("[MinGit] Validating downloaded archive SHA-256")
        assertMinGitChecksum(await sha256(temporary))
      },
    })
    console.log("[MinGit] Promoting verified archive to cache")
    await rename(temporary, archive)
    return archive
  })
}

async function runPowerShell(command: string) {
  const child = Bun.spawn(
    ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { stdout: "inherit", stderr: "inherit" },
  )
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`PowerShell command failed with exit code ${exitCode}`)
}

function quotePowerShell(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

async function requireFile(file: string, description = "Expected package file was not created") {
  if (!(await Bun.file(file).exists())) throw new Error(`${description}: ${file}`)
}

export async function packageInternalWindows() {
  assertInternalWindowsHost(process.platform, process.arch)
  const packageDir = path.resolve(import.meta.dirname, "..")
  const root = path.resolve(packageDir, "../..")
  const plan = createInternalWindowsArtifactPlan(packageDir, pkg.version)
  const buildCommands = createDesktopBuildCommands()
  const cachedModels = path.join(homedir(), ".cache", "opencode", "models.json")
  const guide = path.join(root, "docs", "product", "internal-beta-testing-windows.md")

  await requireFile(guide, "Windows tester guide is required")

  process.env.OPENCODE_CHANNEL = "beta"
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false"
  if (!process.env.MODELS_DEV_API_JSON && (await Bun.file(cachedModels).exists())) {
    process.env.MODELS_DEV_API_JSON = cachedModels
  }

  console.log("[Windows package] Cleaning previous build outputs")
  await rm(plan.directory, { recursive: true, force: true })
  await Promise.all([
    rm(plan.builderInstaller, { force: true }),
    rm(plan.unpacked, { recursive: true, force: true }),
    rm(plan.staging, { recursive: true, force: true }),
  ])

  console.log("[Windows package] Preparing bundled MinGit")
  const archive = await downloadMinGit()
  console.log("[Windows package] Extracting bundled MinGit")
  await mkdir(path.dirname(plan.staging), { recursive: true })
  await runPowerShell(
    `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(plan.staging)} -Force`,
  )
  await Promise.all([
    requireFile(path.join(plan.staging, "cmd", "git.exe")),
    requireFile(path.join(plan.staging, "LICENSE.txt")),
  ])

  process.env.GUAI_CODE_BUNDLED_GIT_DIR = plan.staging
  console.log("[Windows package] Preparing desktop assets")
  await $`bun ./scripts/prebuild.ts`.cwd(packageDir)
  console.log("[Windows package] Building desktop application")
  await $`${buildCommands[0]}`.cwd(packageDir)
  console.log("[Windows package] Creating Windows installer and unpacked application")
  await $`${buildCommands[1]}`.cwd(packageDir)

  console.log("[Windows package] Validating packaged application resources")
  if (!(await stat(plan.unpacked)).isDirectory()) {
    throw new Error(`Expected unpacked application directory was not created: ${plan.unpacked}`)
  }
  const resources = path.join(plan.unpacked, "resources")
  if (!(await stat(resources)).isDirectory()) {
    throw new Error(`Expected unpacked application resources were not created: ${resources}`)
  }
  await Promise.all([
    requireFile(plan.builderInstaller),
    requireFile(path.join(plan.unpacked, "Guai Code Beta.exe")),
    requireFile(path.join(resources, "mingit", "cmd", "git.exe")),
    requireFile(path.join(resources, "mingit", "LICENSE.txt")),
    requireFile(path.join(resources, "licenses", "OpenCode-MIT.txt")),
  ])

  console.log("[Windows package] Creating and verifying portable ZIP")
  await mkdir(plan.directory, { recursive: true })
  await runPowerShell(createPortableZipCommand(plan.unpacked, plan.portableZip))
  await runPowerShell(createPortableZipVerificationCommand(plan.portableZip))
  await Promise.all([
    copyFile(plan.builderInstaller, plan.installer),
    copyFile(guide, plan.guide),
    copyFile(path.join(root, "LICENSE"), plan.openCodeLicense),
    copyFile(path.join(plan.staging, "LICENSE.txt"), plan.gitLicense),
  ])
  console.log("[Windows package] Writing delivery checksums")
  await Bun.write(
    plan.checksums,
    formatChecksumManifest([
      { file: plan.installer, sha256: await sha256(plan.installer) },
      { file: plan.portableZip, sha256: await sha256(plan.portableZip) },
      { file: plan.guide, sha256: await sha256(plan.guide) },
      { file: plan.openCodeLicense, sha256: await sha256(plan.openCodeLicense) },
      { file: plan.gitLicense, sha256: await sha256(plan.gitLicense) },
    ]),
  )

  console.log(`Internal Windows Beta package ready: ${plan.directory}`)
}

if (import.meta.main) await packageInternalWindows()

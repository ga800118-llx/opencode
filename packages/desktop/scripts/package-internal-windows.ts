#!/usr/bin/env bun

import { $ } from "bun"
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest, sha256 } from "./internal-package"

export const MINGIT_RELEASE = "v2.55.0.windows.3"
export const MINGIT_ASSET = "MinGit-2.55.0.3-64-bit.zip"
export const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/${MINGIT_RELEASE}/${MINGIT_ASSET}`
export const MINGIT_SHA256 = "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05"

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

async function downloadMinGit() {
  const directory = path.join(homedir(), ".cache", "guai-code", "internal-package")
  const archive = path.join(directory, MINGIT_ASSET)
  await mkdir(directory, { recursive: true })

  if (await Bun.file(archive).exists()) {
    if ((await sha256(archive)) === MINGIT_SHA256) return archive
    await rm(archive, { force: true })
  }

  const temporary = `${archive}.${process.pid}.download`
  await rm(temporary, { force: true })
  const response = await fetch(MINGIT_URL)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download MinGit: HTTP ${response.status} ${response.statusText}`)
  }
  await Bun.write(temporary, response)

  const checksum = await sha256(temporary)
  if (checksum !== MINGIT_SHA256) {
    await rm(temporary, { force: true })
    throw new Error(`MinGit checksum mismatch: expected ${MINGIT_SHA256}, received ${checksum}`)
  }

  await rename(temporary, archive)
  return archive
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

async function requireFile(file: string) {
  if (!(await Bun.file(file).exists())) throw new Error(`Expected package file was not created: ${file}`)
}

export async function packageInternalWindows() {
  assertInternalWindowsHost(process.platform, process.arch)
  const packageDir = path.resolve(import.meta.dirname, "..")
  const root = path.resolve(packageDir, "../..")
  const plan = createInternalWindowsArtifactPlan(packageDir, pkg.version)
  const cachedModels = path.join(homedir(), ".cache", "opencode", "models.json")

  process.env.OPENCODE_CHANNEL = "beta"
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false"
  if (!process.env.MODELS_DEV_API_JSON && (await Bun.file(cachedModels).exists())) {
    process.env.MODELS_DEV_API_JSON = cachedModels
  }

  await rm(plan.directory, { recursive: true, force: true })
  await Promise.all([
    rm(plan.builderInstaller, { force: true }),
    rm(plan.unpacked, { recursive: true, force: true }),
    rm(plan.staging, { recursive: true, force: true }),
  ])

  const archive = await downloadMinGit()
  await mkdir(path.dirname(plan.staging), { recursive: true })
  await runPowerShell(
    `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(plan.staging)} -Force`,
  )
  await Promise.all([
    requireFile(path.join(plan.staging, "cmd", "git.exe")),
    requireFile(path.join(plan.staging, "LICENSE.txt")),
  ])

  process.env.GUAI_CODE_BUNDLED_GIT_DIR = plan.staging
  await $`bun ./scripts/prebuild.ts`.cwd(packageDir)
  await $`./node_modules/.bin/electron-vite build`.cwd(packageDir)
  await $`./node_modules/.bin/electron-builder --win --x64 --publish never --config electron-builder.config.ts`.cwd(
    packageDir,
  )

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

  await mkdir(plan.directory, { recursive: true })
  await runPowerShell(
    `$global:ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path ${quotePowerShell(path.join(plan.unpacked, "*"))} -DestinationPath ${quotePowerShell(plan.portableZip)} -CompressionLevel Optimal -Force`,
  )
  await Promise.all([
    copyFile(plan.builderInstaller, plan.installer),
    copyFile(path.join(root, "docs", "product", "internal-beta-testing-windows.md"), plan.guide),
    copyFile(path.join(root, "LICENSE"), plan.openCodeLicense),
    copyFile(path.join(plan.staging, "LICENSE.txt"), plan.gitLicense),
  ])
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

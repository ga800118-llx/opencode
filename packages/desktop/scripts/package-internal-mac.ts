#!/usr/bin/env bun

import { $ } from "bun"
import { copyFile, mkdir, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest, sha256 } from "./internal-package"

export { formatChecksumManifest, sha256 } from "./internal-package"

export function assertInternalMacHost(platform: NodeJS.Platform, arch: string) {
  if (platform !== "darwin") throw new Error("The internal Mac package must be built on macOS.")
  if (arch !== "arm64") throw new Error("This internal package currently supports Apple Silicon only.")
}

export function createInternalMacArtifactPlan(packageDir: string, version: string, arch: string) {
  const builderStem = `guai-code-desktop-beta-${version}-mac-${arch}`
  const deliveryStem = `Guai-Code-Beta-${version}-mac-${arch}`
  const directory = path.join(packageDir, "dist", "internal-beta", version)
  return {
    app: path.join(packageDir, "dist", `mac-${arch}`, "Guai Code Beta.app"),
    builderDmg: path.join(packageDir, "dist", `${builderStem}.dmg`),
    builderZip: path.join(packageDir, "dist", `${builderStem}.zip`),
    directory,
    dmg: path.join(directory, `${deliveryStem}.dmg`),
    zip: path.join(directory, `${deliveryStem}.zip`),
    checksums: path.join(directory, "SHA256SUMS.txt"),
    guide: path.join(directory, "Guai-Code-Beta-试用说明.md"),
    license: path.join(directory, "OpenCode-MIT-License.txt"),
  }
}

export function getInternalMacElectronDist(packageDir: string) {
  return path.join(packageDir, "node_modules", "electron", "dist")
}

async function packageInternalMac() {
  assertInternalMacHost(process.platform, process.arch)
  const packageDir = path.resolve(import.meta.dirname, "..")
  const root = path.resolve(packageDir, "../..")
  const plan = createInternalMacArtifactPlan(packageDir, pkg.version, process.arch)
  const cachedModels = path.join(homedir(), ".cache", "opencode", "models.json")

  process.env.OPENCODE_CHANNEL = "beta"
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false"
  if (!process.env.MODELS_DEV_API_JSON && (await Bun.file(cachedModels).exists())) {
    process.env.MODELS_DEV_API_JSON = cachedModels
  }

  await rm(plan.directory, { recursive: true, force: true })
  await Promise.all([
    rm(plan.builderDmg, { force: true }),
    rm(plan.builderZip, { force: true }),
    rm(path.dirname(plan.app), { recursive: true, force: true }),
  ])

  await $`bun ./scripts/prebuild.ts`.cwd(packageDir)
  await $`./node_modules/.bin/electron-vite build`.cwd(packageDir)
  await $`./node_modules/.bin/electron-builder --mac dmg zip --publish never --config electron-builder.config.ts --config.electronDist=${getInternalMacElectronDist(packageDir)}`.cwd(
    packageDir,
  )

  if (!(await stat(plan.app)).isDirectory()) throw new Error(`Expected application bundle was not created: ${plan.app}`)
  for (const file of [plan.builderDmg, plan.builderZip]) {
    if (!(await Bun.file(file).exists())) throw new Error(`Expected package output was not created: ${file}`)
  }

  await $`codesign --verify --deep --strict --verbose=2 ${plan.app}`
  await $`hdiutil verify ${plan.builderDmg}`
  await $`unzip -t ${plan.builderZip}`.quiet()

  await mkdir(plan.directory, { recursive: true })
  await Promise.all([
    copyFile(plan.builderDmg, plan.dmg),
    copyFile(plan.builderZip, plan.zip),
    copyFile(path.join(root, "docs/product/internal-beta-testing.md"), plan.guide),
    copyFile(path.join(root, "LICENSE"), plan.license),
  ])
  await Bun.write(
    plan.checksums,
    formatChecksumManifest([
      { file: plan.dmg, sha256: await sha256(plan.dmg) },
      { file: plan.zip, sha256: await sha256(plan.zip) },
      { file: plan.guide, sha256: await sha256(plan.guide) },
      { file: plan.license, sha256: await sha256(plan.license) },
    ]),
  )

  console.log(`Internal Beta package ready: ${plan.directory}`)
}

if (import.meta.main) await packageInternalMac()

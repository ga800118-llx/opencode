#!/usr/bin/env bun

import {
  chmod,
  copyFile,
  cp,
  lstat,
  lutimes,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises"
import { homedir, hostname, tmpdir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest, sha256 } from "./internal-package"

export { formatChecksumManifest, sha256 } from "./internal-package"

export const MAC_GIT_RELEASE = "v2.53.0-4"
export const MAC_GIT_VERSION = "2.53.0"
export const MAC_GIT_ASSET = "dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz"
export const MAC_GIT_URL = `https://github.com/desktop/dugite-native/releases/download/${MAC_GIT_RELEASE}/${MAC_GIT_ASSET}`
export const MAC_GIT_SHA256 = "f9dc64635a5b62fbd7ad95db73268bbb8912255ac516d65d37bf7af22fcb8ffe"
export const MAC_GIT_SIZE_BYTES = 62_348_987
export const MAC_GIT_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
export const MAC_GIT_DOWNLOAD_ATTEMPTS = 3
export const MAC_GIT_DOWNLOAD_RETRY_DELAY_MS = 5_000
export const MAC_GIT_LICENSE_URL = "https://raw.githubusercontent.com/git/git/v2.53.0/COPYING"
export const MAC_GIT_LICENSE_SHA256 = "5b2198d1645f767585e8a88ac0499b04472164c0d2da22e75ecf97ef443ab32e"
export const MAC_GIT_LICENSE_SIZE_BYTES = 18_765
export const MAC_DMGBUILD_RELEASE = "dmg-builder@1.2.5"
export const MAC_DMGBUILD_VERSION = "1.2.5"
export const MAC_DMGBUILD_ASSET = "dmgbuild-bundle-arm64-75c8a6c.tar.gz"
export const MAC_DMGBUILD_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${MAC_DMGBUILD_RELEASE}/${MAC_DMGBUILD_ASSET}`
export const MAC_DMGBUILD_SHA256 = "793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb"
export const MAC_DMGBUILD_SIZE_BYTES = 22_995_919

export function assertInternalMacHost(platform: NodeJS.Platform, arch: string) {
  if (platform !== "darwin") throw new Error("The internal Mac package must be built on macOS.")
  if (arch !== "arm64") throw new Error("This internal package currently supports Apple Silicon only.")
}

export function createInternalMacArtifactPlan(
  packageDir: string,
  version: string,
  arch: string,
  deliveryPackageDir = packageDir,
  deliveryDirectory = path.join(deliveryPackageDir, "dist", "internal-beta", version),
) {
  const builderStem = `guai-code-desktop-beta-${version}-mac-${arch}`
  const deliveryStem = `Guai-Code-Beta-${version}-mac-${arch}`
  const directory = deliveryDirectory
  return {
    app: path.join(packageDir, "dist", `mac-${arch}`, "Guai Code Beta.app"),
    builderDmg: path.join(packageDir, "dist", `${builderStem}.dmg`),
    builderZip: path.join(packageDir, "dist", `${builderStem}.zip`),
    directory,
    dmg: path.join(directory, `${deliveryStem}.dmg`),
    zip: path.join(directory, `${deliveryStem}.zip`),
    checksums: path.join(directory, "SHA256SUMS.txt"),
    buildInfo: path.join(directory, "BUILD-INFO.json"),
    guide: path.join(directory, "Guai-Code-Beta-试用说明.md"),
    license: path.join(directory, "OpenCode-MIT-License.txt"),
    gitLicense: path.join(directory, "Git-GPLv2-License.txt"),
  }
}

export function getInternalMacElectronDist(packageDir: string) {
  return path.join(packageDir, "node_modules", "electron", "dist")
}

export type InternalMacSourceProvenance = {
  commit: string
  tree: string
  branch: string
  commitTimestamp: string
  trackedClean: boolean
  untrackedFilesPresent: boolean
}

export function createInternalMacBuildMetadata(input: {
  version: string
  arch: string
  source: InternalMacSourceProvenance
  buildTimestamp: string
  inputs: {
    modelsSha256: string
    electronVersion: string
    electronSha256: string
    bunVersion: string
    bunSha256: string
    gitVersion: string
    gitSha256: string
    gitSizeBytes: number
    dmgbuildVersion: string
    dmgbuildSha256: string
    dmgbuildSizeBytes: number
  }
}) {
  assertGitObjectID(input.source.commit, "commit")
  assertGitObjectID(input.source.tree, "tree")
  assertSha256(input.inputs.modelsSha256, "models snapshot")
  assertSha256(input.inputs.electronSha256, "Electron runtime")
  assertSha256(input.inputs.bunSha256, "Bun runtime")
  assertSha256(input.inputs.gitSha256, "bundled Git")
  assertSha256(input.inputs.dmgbuildSha256, "dmgbuild")
  if (!input.inputs.electronVersion.trim()) throw new Error("Electron runtime version is required")
  if (!input.inputs.bunVersion.trim()) throw new Error("Bun runtime version is required")
  if (!input.inputs.gitVersion.trim()) throw new Error("Bundled Git version is required")
  if (!input.inputs.dmgbuildVersion.trim()) throw new Error("dmgbuild version is required")
  if (!Number.isSafeInteger(input.inputs.gitSizeBytes) || input.inputs.gitSizeBytes <= 0) {
    throw new Error("Bundled Git size is required")
  }
  if (
    input.inputs.gitVersion !== MAC_GIT_VERSION ||
    input.inputs.gitSha256 !== MAC_GIT_SHA256 ||
    input.inputs.gitSizeBytes !== MAC_GIT_SIZE_BYTES
  ) {
    throw new Error("Bundled Git metadata does not match the pinned Mac Git distribution")
  }
  if (
    input.inputs.dmgbuildVersion !== MAC_DMGBUILD_VERSION ||
    input.inputs.dmgbuildSha256 !== MAC_DMGBUILD_SHA256 ||
    input.inputs.dmgbuildSizeBytes !== MAC_DMGBUILD_SIZE_BYTES
  ) {
    throw new Error("dmgbuild metadata does not match the pinned Mac distribution")
  }
  if (input.buildTimestamp !== input.source.commitTimestamp) {
    throw new Error("Build timestamp must match the source commit timestamp")
  }
  assertInternalMacSourceReady(input.source)
  return {
    schemaVersion: 5,
    product: "Guai Code Beta",
    channel: "beta",
    version: input.version,
    platform: "darwin",
    arch: input.arch,
    source: {
      vcs: "git",
      commit: input.source.commit,
      tree: input.source.tree,
      branch: input.source.branch,
      commitTimestamp: input.source.commitTimestamp,
      trackedClean: true,
      untrackedFilesPresent: input.source.untrackedFilesPresent,
      buildMode: "isolated-git-archive",
    },
    inputs: {
      models: {
        format: "models.dev-json",
        sha256: input.inputs.modelsSha256,
      },
      electron: {
        version: input.inputs.electronVersion,
        sha256: input.inputs.electronSha256,
      },
      bun: {
        version: input.inputs.bunVersion,
        sha256: input.inputs.bunSha256,
      },
      git: {
        distribution: "desktop/dugite-native",
        release: MAC_GIT_RELEASE,
        version: input.inputs.gitVersion,
        sha256: input.inputs.gitSha256,
        sizeBytes: input.inputs.gitSizeBytes,
      },
      dmgbuild: {
        distribution: "electron-userland/electron-builder-binaries",
        release: MAC_DMGBUILD_RELEASE,
        version: input.inputs.dmgbuildVersion,
        sha256: input.inputs.dmgbuildSha256,
        sizeBytes: input.inputs.dmgbuildSizeBytes,
      },
    },
    buildTimestamp: input.buildTimestamp,
  }
}

export function assertInternalMacSourceReady(source: InternalMacSourceProvenance) {
  if (!source.trackedClean) {
    throw new Error("Internal Mac packages require committed source with no staged or unstaged tracked changes.")
  }
}

export function assertInternalMacSourceUnchanged(
  before: InternalMacSourceProvenance,
  after: InternalMacSourceProvenance,
) {
  assertInternalMacSourceReady(after)
  if (before.commit !== after.commit || before.tree !== after.tree || before.branch !== after.branch) {
    throw new Error("Git source changed while the internal Mac package was being built.")
  }
}

export function renderInternalMacGuide(template: string, version: string) {
  const marker = "{{VERSION}}"
  if (!template.includes(marker)) throw new Error(`Internal Mac tester guide must contain ${marker}`)
  return template.replaceAll(marker, version)
}

export function getInternalMacDeliveryFiles(plan: ReturnType<typeof createInternalMacArtifactPlan>) {
  return [plan.dmg, plan.zip, plan.buildInfo, plan.guide, plan.license, plan.gitLicense]
}

type CommandRunner = (command: readonly string[]) => Promise<void>
type CapturedCommandRunner = (
  command: readonly string[],
  options: { cwd: string; env: Record<string, string> },
) => Promise<{ stdout: string; stderr: string }>

async function runCommand(command: readonly string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const child = Bun.spawn(command, { ...options, stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
}

export async function buildInternalMacArtifacts(
  input: {
    bunExecutable: string
    electronDist: string
    appBundle: string
    builderDmg: string
    builderZip: string
    buildTimestamp: string
    cwd: string
    env: Record<string, string>
  },
  runner: typeof runCommand = runCommand,
) {
  await runner(
    [
      input.bunExecutable,
      "run",
      "electron-builder",
      "--mac",
      "--dir",
      "--publish",
      "never",
      "--config",
      "electron-builder.config.ts",
      `--config.electronDist=${input.electronDist}`,
    ],
    { cwd: input.cwd, env: input.env },
  )
  if (!(await stat(input.appBundle).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Expected signed application bundle was not created: ${input.appBundle}`)
  }
  await normalizeInternalMacTimestamps(input.appBundle, input.buildTimestamp)
  await runner(
    [
      input.bunExecutable,
      "run",
      "electron-builder",
      "--mac",
      "dmg",
      "zip",
      "--prepackaged",
      input.appBundle,
      "--publish",
      "never",
      "--config",
      "electron-builder.config.ts",
    ],
    { cwd: input.cwd, env: input.env },
  )
  await assertInternalMacTimestampsNormalized(input.appBundle, input.buildTimestamp)
  for (const file of [input.builderDmg, input.builderZip]) {
    if (!(await Bun.file(file).exists())) throw new Error(`Expected package output was not created: ${file}`)
  }
}

export async function normalizeInternalMacTimestamps(target: string, timestamp: string) {
  const normalized = parseInternalMacTimestamp(timestamp)
  await walkInternalMacArchiveInput(target, async (current, entry) => {
    if (entry.isSymbolicLink()) {
      await lutimes(current, normalized, normalized)
      return
    }
    await utimes(current, normalized, normalized)
  })
}

async function assertInternalMacTimestampsNormalized(target: string, timestamp: string) {
  const normalized = parseInternalMacTimestamp(timestamp).getTime()
  const mismatches: string[] = []
  await walkInternalMacArchiveInput(target, async (current, entry) => {
    if (Math.round(entry.mtimeMs) !== normalized) mismatches.push(`${current}: ${entry.mtime.toISOString()}`)
  })
  if (mismatches.length > 0) {
    throw new Error(
      `Prepackaged application timestamps changed while creating ZIP/DMG; expected ${timestamp}. ` +
        `Mismatches: ${mismatches.slice(0, 5).join(", ")}`,
    )
  }
}

function parseInternalMacTimestamp(timestamp: string) {
  const normalized = new Date(timestamp)
  if (!Number.isFinite(normalized.getTime())) throw new Error(`Invalid source commit timestamp: ${timestamp}`)
  return normalized
}

async function walkInternalMacArchiveInput(
  target: string,
  visit: (target: string, entry: Awaited<ReturnType<typeof lstat>>) => Promise<void>,
) {
  const entry = await lstat(target)
  if (!entry.isDirectory()) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error(`Unsupported archive input while normalizing timestamps: ${target}`)
    }
    await visit(target, entry)
    return
  }

  const names = await readdir(target)
  const batches = Array.from({ length: Math.ceil(names.length / 64) }, (_, index) =>
    names.slice(index * 64, index * 64 + 64),
  )
  await batches.reduce(async (previous, batch) => {
    await previous
    await Promise.all(batch.map((name) => walkInternalMacArchiveInput(path.join(target, name), visit)))
  }, Promise.resolve())
  await visit(target, entry)
}

async function runCapturedCommand(command: readonly string[], options: { cwd: string; env: Record<string, string> }) {
  const child = Bun.spawn(command, { ...options, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(
      `exit ${exitCode}: ${command.join(" ")}\nstdout: ${stdout.trim() || "<empty>"}\nstderr: ${stderr.trim() || "<empty>"}`,
    )
  }
  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

export async function verifyInternalMacDeliveryArtifacts(
  plan: ReturnType<typeof createInternalMacArtifactPlan>,
  runner: CommandRunner = runCommand,
) {
  await runner(["/usr/bin/unzip", "-t", plan.zip])
  await runner(["/usr/bin/hdiutil", "verify", plan.dmg])
}

export async function verifyInternalMacBundledGit(
  appBundle: string,
  input: {
    temporaryDirectory?: string
    run?: CapturedCommandRunner
  } = {},
) {
  const root = path.join(appBundle, "Contents", "Resources", "mingit")
  const executable = path.join(root, "bin", "git")
  if (!(await Bun.file(executable).exists())) throw new Error(`Packaged Git executable is missing: ${executable}`)
  for (const required of [
    path.join(root, "libexec", "git-core", "git"),
    path.join(root, "etc", "gitconfig"),
    path.join(root, "COPYING"),
  ]) {
    if (!(await Bun.file(required).exists())) throw new Error(`Packaged Git runtime is incomplete: ${required}`)
  }
  const templates = path.join(root, "share", "git-core", "templates")
  if (!(await stat(templates).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Packaged Git runtime is incomplete: ${templates}`)
  }

  const temporaryDirectory =
    input.temporaryDirectory ?? path.join(tmpdir(), `guai-code-mac-git-smoke-${crypto.randomUUID()}`)
  const repository = path.join(temporaryDirectory, "repository")
  const worktree = path.join(temporaryDirectory, "worktree")
  const gitExecPath = path.join(root, "libexec", "git-core")
  const environment = {
    PATH: path.join(root, "bin"),
    HOME: path.join(temporaryDirectory, "home"),
    TMPDIR: path.join(temporaryDirectory, "tmp"),
    XDG_CONFIG_HOME: path.join(temporaryDirectory, "xdg", "config"),
    XDG_CACHE_HOME: path.join(temporaryDirectory, "xdg", "cache"),
    XDG_DATA_HOME: path.join(temporaryDirectory, "xdg", "data"),
    XDG_STATE_HOME: path.join(temporaryDirectory, "xdg", "state"),
    CFFIXED_USER_HOME: path.join(temporaryDirectory, "home"),
    DARWIN_USER_CACHE_DIR: path.join(temporaryDirectory, "mac", "cache"),
    DARWIN_USER_TEMP_DIR: path.join(temporaryDirectory, "tmp"),
    GIT_EXEC_PATH: gitExecPath,
    GIT_CONFIG_SYSTEM: path.join(root, "etc", "gitconfig"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TEMPLATE_DIR: templates,
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  }
  const run = input.run ?? runCapturedCommand
  const git = async (stage: string, args: readonly string[]) =>
    run([executable, ...args], { cwd: temporaryDirectory, env: environment }).catch((error: unknown) => {
      throw new Error(
        `Bundled Git verification failed while attempting to ${stage}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    })

  try {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await Promise.all([
      mkdir(path.join(temporaryDirectory, "home"), { recursive: true }),
      mkdir(path.join(temporaryDirectory, "tmp"), { recursive: true }),
      mkdir(path.join(temporaryDirectory, "xdg", "config"), { recursive: true }),
      mkdir(path.join(temporaryDirectory, "xdg", "cache"), { recursive: true }),
      mkdir(path.join(temporaryDirectory, "xdg", "data"), { recursive: true }),
      mkdir(path.join(temporaryDirectory, "xdg", "state"), { recursive: true }),
      mkdir(path.join(temporaryDirectory, "mac", "cache"), { recursive: true }),
    ])
    await git("read the packaged Git version", ["--version"])
    const relocatedGitExecPath = await git("resolve the relocated git-core directory", ["--exec-path"])
    if (relocatedGitExecPath.stdout !== gitExecPath) {
      throw new Error(
        `Bundled Git relocation failed: expected git-core ${gitExecPath}, received ${relocatedGitExecPath.stdout || "<empty>"}`,
      )
    }
    await git("initialize the packaged Git smoke repository", ["init", "--quiet", "--initial-branch=main", repository])
    await git("configure the packaged Git smoke user name", [
      "-C",
      repository,
      "config",
      "--local",
      "user.name",
      "Guai Code Smoke",
    ])
    await git("configure the packaged Git smoke user email", [
      "-C",
      repository,
      "config",
      "--local",
      "user.email",
      "guai-code-smoke@example.invalid",
    ])
    await Bun.write(path.join(repository, "packaged-git-smoke.txt"), "packaged Git relocation smoke\n")
    await git("stage with packaged Git", ["-C", repository, "add", "packaged-git-smoke.txt"])
    await git("commit packaged Git smoke repository", [
      "-C",
      repository,
      "commit",
      "--quiet",
      "-m",
      "test: packaged Git relocation",
    ])
    const commit = await git("resolve the packaged Git smoke commit", [
      "-C",
      repository,
      "rev-parse",
      "--verify",
      "HEAD",
    ])
    assertGitObjectID(commit.stdout, "smoke commit")
    await git("create a worktree with packaged Git", [
      "-C",
      repository,
      "worktree",
      "add",
      "--quiet",
      "--detach",
      worktree,
      "HEAD",
    ])
    const worktreeRoot = await git("resolve the packaged Git worktree", [
      "-C",
      worktree,
      "rev-parse",
      "--show-toplevel",
    ])
    if ((await realpath(worktreeRoot.stdout)) !== (await realpath(worktree))) {
      throw new Error(`Bundled Git worktree relocation failed: expected ${worktree}, received ${worktreeRoot.stdout}`)
    }
    const worktreeCommit = await git("resolve the packaged Git worktree commit", [
      "-C",
      worktree,
      "rev-parse",
      "--verify",
      "HEAD",
    ])
    if (worktreeCommit.stdout !== commit.stdout) {
      throw new Error(
        `Bundled Git worktree commit mismatch: expected ${commit.stdout}, received ${worktreeCommit.stdout}`,
      )
    }
    const status = await git("verify the packaged Git worktree status", ["-C", worktree, "status", "--porcelain=v1"])
    if (status.stdout) throw new Error(`Bundled Git worktree is not clean: ${status.stdout}`)
    const worktreeContents = await Bun.file(path.join(worktree, "packaged-git-smoke.txt")).text()
    if (worktreeContents !== "packaged Git relocation smoke\n") {
      throw new Error("Bundled Git worktree did not check out the committed smoke file")
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export function createInternalMacSmokeEnvironment(temporaryDirectory: string, bundledGitExecutable: string) {
  return {
    PATH: path.join(temporaryDirectory, "bin"),
    HOME: path.join(temporaryDirectory, "home"),
    TMPDIR: path.join(temporaryDirectory, "tmp"),
    XDG_CONFIG_HOME: path.join(temporaryDirectory, "xdg", "config"),
    XDG_CACHE_HOME: path.join(temporaryDirectory, "xdg", "cache"),
    XDG_DATA_HOME: path.join(temporaryDirectory, "xdg", "data"),
    XDG_STATE_HOME: path.join(temporaryDirectory, "xdg", "state"),
    CFFIXED_USER_HOME: path.join(temporaryDirectory, "home"),
    DARWIN_USER_CACHE_DIR: path.join(temporaryDirectory, "mac", "cache"),
    DARWIN_USER_TEMP_DIR: path.join(temporaryDirectory, "tmp"),
    USER: "guai-code-smoke",
    LOGNAME: "guai-code-smoke",
    SHELL: "/usr/bin/false",
    LANG: "C",
    LC_ALL: "C",
    GIT_TRACE2_EVENT: path.join(temporaryDirectory, "git-trace.json"),
    GUAI_CODE_INTERNAL_PACKAGE_GIT: bundledGitExecutable,
    OPENCODE_UPDATER_ENABLED: "false",
    OPENCODE_SIDECAR_V2: "0",
  }
}

export function assertInternalMacSmokeEvidence(contents: string, bundledGitDirectory: string) {
  const bundledGit = contents.indexOf("bundled git enabled")
  const bundledGitPath = contents.indexOf(bundledGitDirectory, bundledGit)
  if (bundledGit < 0 || bundledGitPath < bundledGit) {
    throw new Error(`Packaged application did not enable the bundled Git directory: ${bundledGitDirectory}`)
  }
  const sidecar = contents.indexOf("spawning supervised sidecar")
  if (sidecar < 0) throw new Error("Packaged application did not start the supervised sidecar")
  const ready = contents.indexOf("loading task finished")
  if (ready < 0) throw new Error("Packaged application did not complete startup")
  if (bundledGit > sidecar) throw new Error("Packaged application did not enable bundled Git before sidecar startup")
  if (sidecar > ready) throw new Error("Packaged application reported sidecar readiness out of order")
}

type InternalMacSmokeProcess = {
  pid?: number
  exitCode: number | null
  exited: Promise<number>
  stdout?: ReadableStream<Uint8Array> | null
  stderr?: ReadableStream<Uint8Array> | null
  kill: (signal?: NodeJS.Signals | number) => void
}

type InternalMacSmokeSpawn = (
  command: readonly string[],
  options: {
    cwd: string
    env: Record<string, string>
    stdout: "pipe"
    stderr: "pipe"
  },
) => InternalMacSmokeProcess

export async function verifyInternalMacPackagedApp(
  appBundle: string,
  input: {
    temporaryDirectory?: string
    timeoutMs?: number
    spawn?: InternalMacSmokeSpawn
    waitForReady?: (temporaryDirectory: string, child: InternalMacSmokeProcess) => Promise<string>
  } = {},
) {
  const executable = path.join(appBundle, "Contents", "MacOS", "Guai Code Beta")
  if (!(await Bun.file(executable).exists()))
    throw new Error(`Packaged application executable is missing: ${executable}`)
  const temporaryDirectory =
    input.temporaryDirectory ?? path.join(tmpdir(), `guai-code-mac-app-smoke-${crypto.randomUUID()}`)
  try {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await Promise.all(
      [
        "bin",
        "home",
        "tmp",
        path.join("xdg", "config"),
        path.join("xdg", "cache"),
        path.join("xdg", "data"),
        path.join("xdg", "state"),
        path.join("mac", "cache"),
        "workspace",
      ].map((directory) => mkdir(path.join(temporaryDirectory, directory), { recursive: true })),
    )
    const bundledGitRoot = path.join(appBundle, "Contents", "Resources", "mingit")
    const bundledGitExecutable = await realpath(path.join(bundledGitRoot, "bin", "git"))
    const child = (input.spawn ?? (Bun.spawn as InternalMacSmokeSpawn))(
      [executable, `--user-data-dir=${path.join(temporaryDirectory, "desktop")}`],
      {
        cwd: path.join(temporaryDirectory, "workspace"),
        env: createInternalMacSmokeEnvironment(temporaryDirectory, bundledGitExecutable),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const stdout = child.stdout ? new Response(child.stdout).text() : Promise.resolve("")
    const stderr = child.stderr ? new Response(child.stderr).text() : Promise.resolve("")
    const waitForReady =
      input.waitForReady ??
      (async (directory: string, process) => {
        const deadline = Date.now() + (input.timeoutMs ?? 90_000)
        while (Date.now() < deadline) {
          const files = await readdir(directory, { recursive: true }).catch(() => [])
          const logs = files.filter((file) => typeof file === "string" && file.endsWith("main.log"))
          const contents = await Promise.all(
            logs.map((file) =>
              Bun.file(path.join(directory, file))
                .text()
                .catch(() => ""),
            ),
          ).then((logs) => logs.join("\n"))
          if (contents.includes("loading task finished")) return contents
          if (process.exitCode !== null) {
            throw new Error(`Packaged application exited with code ${process.exitCode} before startup completed`)
          }
          await Bun.sleep(250)
        }
        throw new Error(`Packaged application did not complete startup within ${input.timeoutMs ?? 90_000}ms`)
      })
    const verification = await Promise.resolve()
      .then(async () => {
        const contents = await waitForReady(temporaryDirectory, child)
        assertInternalMacSmokeEvidence(contents, path.join(bundledGitRoot, "bin"))
        const deadline = Date.now() + (input.timeoutMs ?? 90_000)
        while (Date.now() < deadline) {
          const gitTrace = await Bun.file(path.join(temporaryDirectory, "git-trace.json"))
            .text()
            .catch(() => "")
          if (internalMacSidecarGitTraceExecutable(gitTrace) === bundledGitExecutable) return
          if (child.exitCode !== null) {
            throw new Error(
              `Packaged application exited with code ${child.exitCode} before sidecar Git evidence completed`,
            )
          }
          await Bun.sleep(250)
        }
        assertInternalMacSidecarGitTrace(
          await Bun.file(path.join(temporaryDirectory, "git-trace.json"))
            .text()
            .catch(() => ""),
          bundledGitExecutable,
        )
      })
      .then(
        () => ({ success: true as const }),
        (error: unknown) => ({ success: false as const, error }),
      )
    if (child.exitCode === null) child.kill("SIGTERM")
    const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)])
    if (!exited) {
      child.kill("SIGKILL")
      const killed = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)])
      if (!killed) throw new Error(`Packaged application process did not exit after SIGKILL: ${executable}`)
    }
    const [stdoutContents, stderrContents] = await Promise.all([stdout, stderr])
    if (!verification.success) {
      throw new Error(
        `${verification.error instanceof Error ? verification.error.message : String(verification.error)}\n` +
          `stdout: ${stdoutContents.trim() || "<empty>"}\n` +
          `stderr: ${stderrContents.trim() || "<empty>"}`,
        { cause: verification.error },
      )
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export function assertInternalMacSidecarGitTrace(contents: string, executable: string) {
  const traced = internalMacSidecarGitTraceExecutable(contents)
  if (traced !== executable) {
    throw new Error(
      `Packaged application sidecar did not execute bundled Git ${executable}. Traced executable: ${traced ?? "<none>"}`,
    )
  }
}

function internalMacSidecarGitTraceExecutable(contents: string) {
  return contents
    .split("\n")
    .slice(0, -1)
    .flatMap((line) => {
      if (!line.trim()) return []
      return [JSON.parse(line) as { event?: unknown; argv?: unknown }]
    })
    .find((event) => event.event === "start" && Array.isArray(event.argv) && typeof event.argv[0] === "string")
    ?.argv?.[0] as string | undefined
}

export async function verifyInternalMacPackagedZip(
  archive: string,
  input: {
    temporaryDirectory?: string
    run?: CommandRunner
    verifyBundledGit?: (appBundle: string) => Promise<void>
    verifyPackagedApp?: (appBundle: string) => Promise<void>
  } = {},
) {
  if (!(await Bun.file(archive).exists())) throw new Error(`Final packaged ZIP is missing: ${archive}`)
  const temporaryDirectory =
    input.temporaryDirectory ?? path.join(tmpdir(), `guai-code-mac-final-zip-${crypto.randomUUID()}`)
  const appBundle = path.join(temporaryDirectory, "Guai Code Beta.app")

  try {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await mkdir(temporaryDirectory, { recursive: true })
    await (input.run ?? runCommand)(["/usr/bin/ditto", "-x", "-k", archive, temporaryDirectory]).catch(
      (error: unknown) => {
        throw new Error(`Final ZIP extraction failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        })
      },
    )
    if (!(await stat(appBundle).catch(() => undefined))?.isDirectory()) {
      const entries = await readdir(temporaryDirectory).catch(() => [])
      throw new Error(
        `Final ZIP does not contain Guai Code Beta.app at its root. Extracted entries: ${entries.join(", ") || "<none>"}`,
      )
    }
    await (input.verifyBundledGit ?? verifyInternalMacBundledGit)(appBundle)
    await (input.verifyPackagedApp ?? verifyInternalMacPackagedApp)(appBundle)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function verifyInternalMacChecksumManifest(manifestPath: string, files: readonly string[]) {
  const entries = (await Bun.file(manifestPath).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
      if (!match) throw new Error(`Invalid checksum manifest entry: ${line}`)
      return { sha256: match[1], name: match[2] }
    })
  const expected = files.map((file) => path.basename(file)).sort()
  const actual = entries.map((entry) => entry.name).sort()
  if (new Set(actual).size !== actual.length) throw new Error("Checksum manifest contains duplicate entries")
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Checksum manifest files do not match delivery files: ${actual.join(", ")}`)
  }
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(path.dirname(manifestPath), entry.name)
      const checksum = await sha256(file)
      if (checksum !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.name}`)
    }),
  )
}

async function readGitValue(root: string, args: readonly string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Git command failed: ${stderr.trim()}`)
  return stdout.trim()
}

export async function exportInternalMacSource(root: string, commit: string, destination: string) {
  assertGitObjectID(commit, "commit")
  await mkdir(destination, { recursive: true })
  const archive = Bun.spawn(["git", "-C", root, "archive", "--format=tar", commit], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const extract = Bun.spawn(["/usr/bin/tar", "-xf", "-", "-C", destination], {
    stdin: archive.stdout,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [archiveExitCode, extractExitCode, archiveError, extractError] = await Promise.all([
    archive.exited,
    extract.exited,
    new Response(archive.stderr).text(),
    new Response(extract.stderr).text(),
  ])
  if (archiveExitCode !== 0) throw new Error(`Git archive failed: ${archiveError.trim()}`)
  if (extractExitCode !== 0) throw new Error(`Git archive extraction failed: ${extractError.trim()}`)
}

export async function sha256Directory(directory: string) {
  const hasher = new Bun.CryptoHasher("sha256")

  async function walk(current: string, relative: string) {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      const name = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name)
      const mode = ((await lstat(absolute)).mode & 0o7777).toString(8)
      if (entry.isSymbolicLink()) {
        hasher.update(`link\0${name}\0${mode}\0${await readlink(absolute)}\0`)
        continue
      }
      if (entry.isDirectory()) {
        hasher.update(`directory\0${name}\0${mode}\0`)
        await walk(absolute, name)
        continue
      }
      if (!entry.isFile()) throw new Error(`Unsupported Electron runtime entry: ${absolute}`)
      hasher.update(`file\0${name}\0${mode}\0`)
      for await (const chunk of Bun.file(absolute).stream()) hasher.update(chunk)
      hasher.update("\0")
    }
  }

  await walk(directory, "")
  return hasher.digest("hex")
}

export function assertMacGitArchive(size: number, checksum: string) {
  if (size !== MAC_GIT_SIZE_BYTES) {
    throw new Error(`Bundled Mac Git size mismatch: expected ${MAC_GIT_SIZE_BYTES}, received ${size}`)
  }
  if (checksum !== MAC_GIT_SHA256) {
    throw new Error(`Bundled Mac Git checksum mismatch: expected ${MAC_GIT_SHA256}, received ${checksum}`)
  }
}

export function assertMacGitLicense(size: number, checksum: string) {
  if (size !== MAC_GIT_LICENSE_SIZE_BYTES) {
    throw new Error(`Bundled Mac Git license size mismatch: expected ${MAC_GIT_LICENSE_SIZE_BYTES}, received ${size}`)
  }
  if (checksum !== MAC_GIT_LICENSE_SHA256) {
    throw new Error(
      `Bundled Mac Git license checksum mismatch: expected ${MAC_GIT_LICENSE_SHA256}, received ${checksum}`,
    )
  }
}

export function assertMacDmgbuildArchive(size: number, checksum: string) {
  if (size !== MAC_DMGBUILD_SIZE_BYTES) {
    throw new Error(`Mac dmgbuild size mismatch: expected ${MAC_DMGBUILD_SIZE_BYTES}, received ${size}`)
  }
  if (checksum !== MAC_DMGBUILD_SHA256) {
    throw new Error(`Mac dmgbuild checksum mismatch: expected ${MAC_DMGBUILD_SHA256}, received ${checksum}`)
  }
}

export function createMacGitDownloadCommand(destination: string, source = MAC_GIT_URL) {
  return [
    "/usr/bin/curl",
    "--fail",
    "--location",
    "--show-error",
    "--progress-bar",
    "--connect-timeout",
    "30",
    "--output",
    destination,
    source,
  ]
}

type MacGitDownloadOptions = {
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
  run?: (command: readonly string[], timeoutMs: number) => Promise<void>
  delay?: (milliseconds: number) => Promise<void>
  log?: (message: string) => void
}

export async function downloadVerifiedInternalMacFile(input: {
  archive: string
  url: string
  size: number
  checksum: string
  label: string
  options?: MacGitDownloadOptions
}) {
  const options = input.options ?? {}
  const log = options.log ?? console.log
  const validate = async (file: string) => {
    const size = (await stat(file)).size
    const checksum = await sha256(file)
    if (size !== input.size || checksum !== input.checksum) {
      throw new Error(`${input.label} integrity mismatch (size ${size}, SHA-256 ${checksum})`)
    }
  }

  await mkdir(path.dirname(input.archive), { recursive: true })
  if (await Bun.file(input.archive).exists()) {
    const cached = await validate(input.archive).then(
      () => true,
      () => false,
    )
    if (cached) {
      log(`[${input.label}] Using verified cached file`)
      return input.archive
    }
    await rm(input.archive, { force: true })
  }

  const temporary = `${input.archive}.${process.pid}-${crypto.randomUUID()}.download`
  try {
    const attempt = async (current: number): Promise<void> => {
      await rm(temporary, { force: true })
      log(`[${input.label}] Download attempt ${current}/${options.attempts ?? MAC_GIT_DOWNLOAD_ATTEMPTS}`)
      const result = await Promise.resolve()
        .then(async () => {
          await (options.run ?? runDownloadProcess)(
            createMacGitDownloadCommand(temporary, input.url),
            options.timeoutMs ?? MAC_GIT_DOWNLOAD_TIMEOUT_MS,
          )
          await validate(temporary)
        })
        .then(
          () => ({ success: true as const }),
          (error: unknown) => ({ success: false as const, error }),
        )
      if (result.success) return
      const attempts = options.attempts ?? MAC_GIT_DOWNLOAD_ATTEMPTS
      await rm(temporary, { force: true })
      const message = result.error instanceof Error ? result.error.message : String(result.error)
      log(`[${input.label}] Attempt ${current}/${attempts} failed: ${message}`)
      if (current >= attempts) {
        throw new Error(`${input.label} download failed after ${attempts} attempts: ${message}`, {
          cause: result.error,
        })
      }
      await (options.delay ?? ((milliseconds) => Bun.sleep(milliseconds)))(
        options.retryDelayMs ?? MAC_GIT_DOWNLOAD_RETRY_DELAY_MS,
      )
      return attempt(current + 1)
    }

    await attempt(1)
    await rename(temporary, input.archive)
    return input.archive
  } finally {
    await rm(temporary, { force: true })
  }
}

async function runDownloadProcess(command: readonly string[], timeoutMs: number) {
  const child = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Download process failed with exit code ${exitCode}`)
}

export async function prepareInternalMacGit(input: { cacheDirectory: string; destination: string }) {
  const archive = await downloadVerifiedInternalMacFile({
    archive: path.join(input.cacheDirectory, MAC_GIT_ASSET),
    url: MAC_GIT_URL,
    size: MAC_GIT_SIZE_BYTES,
    checksum: MAC_GIT_SHA256,
    label: "Mac Git",
  })
  const license = await downloadVerifiedInternalMacFile({
    archive: path.join(input.cacheDirectory, `git-${MAC_GIT_VERSION}-COPYING`),
    url: MAC_GIT_LICENSE_URL,
    size: MAC_GIT_LICENSE_SIZE_BYTES,
    checksum: MAC_GIT_LICENSE_SHA256,
    label: "Mac Git license",
  })
  await mkdir(input.destination, { recursive: true })
  await runCommand(["/usr/bin/tar", "-xzf", archive, "-C", input.destination])
  await copyFile(license, path.join(input.destination, "COPYING"))
  for (const file of [
    path.join(input.destination, "bin", "git"),
    path.join(input.destination, "libexec", "git-core", "git"),
    path.join(input.destination, "etc", "gitconfig"),
    path.join(input.destination, "COPYING"),
  ]) {
    if (!(await Bun.file(file).exists())) throw new Error(`Bundled Mac Git is incomplete: ${file}`)
  }
  const templates = path.join(input.destination, "share", "git-core", "templates")
  if (!(await stat(templates).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Bundled Mac Git is incomplete: ${templates}`)
  }
  return { archive, license }
}

export async function prepareInternalMacDmgbuild(input: { cacheDirectory: string; destination: string }) {
  const archive = await downloadVerifiedInternalMacFile({
    archive: path.join(input.cacheDirectory, MAC_DMGBUILD_ASSET),
    url: MAC_DMGBUILD_URL,
    size: MAC_DMGBUILD_SIZE_BYTES,
    checksum: MAC_DMGBUILD_SHA256,
    label: "Mac dmgbuild",
  })
  await mkdir(input.destination, { recursive: true })
  await runCommand(["/usr/bin/tar", "-xzf", archive, "-C", input.destination])
  const executable = path.join(input.destination, "dmgbuild")
  const python = path.join(input.destination, "python", "bin", "python3")
  if (!(await Bun.file(executable).exists()) || !(await Bun.file(python).exists())) {
    throw new Error("Mac dmgbuild distribution is incomplete")
  }
  return { archive, executable }
}

export async function readInternalMacBuildInputs(
  modelsSnapshot: string,
  electronDist: string,
  gitArchive?: string,
  bunExecutable = process.execPath,
  dmgbuildArchive?: string,
) {
  const electronVersion = (await Bun.file(path.join(electronDist, "version")).text()).trim()
  if (!electronVersion) throw new Error("Electron runtime version is required")
  const gitSizeBytes = gitArchive ? (await stat(gitArchive)).size : MAC_GIT_SIZE_BYTES
  const gitSha256 = gitArchive ? await sha256(gitArchive) : MAC_GIT_SHA256
  assertMacGitArchive(gitSizeBytes, gitSha256)
  const dmgbuildSizeBytes = dmgbuildArchive ? (await stat(dmgbuildArchive)).size : MAC_DMGBUILD_SIZE_BYTES
  const dmgbuildSha256 = dmgbuildArchive ? await sha256(dmgbuildArchive) : MAC_DMGBUILD_SHA256
  assertMacDmgbuildArchive(dmgbuildSizeBytes, dmgbuildSha256)
  return {
    modelsSha256: await sha256(modelsSnapshot),
    electronVersion,
    electronSha256: await sha256Directory(electronDist),
    bunVersion: Bun.version,
    bunSha256: await sha256(bunExecutable),
    gitVersion: MAC_GIT_VERSION,
    gitSha256,
    gitSizeBytes,
    dmgbuildVersion: MAC_DMGBUILD_VERSION,
    dmgbuildSha256,
    dmgbuildSizeBytes,
  }
}

export function assertInternalMacBuildInputsUnchanged(
  before: Awaited<ReturnType<typeof readInternalMacBuildInputs>>,
  after: Awaited<ReturnType<typeof readInternalMacBuildInputs>>,
) {
  if (
    before.modelsSha256 !== after.modelsSha256 ||
    before.electronVersion !== after.electronVersion ||
    before.electronSha256 !== after.electronSha256 ||
    before.bunVersion !== after.bunVersion ||
    before.bunSha256 !== after.bunSha256 ||
    before.gitVersion !== after.gitVersion ||
    before.gitSha256 !== after.gitSha256 ||
    before.gitSizeBytes !== after.gitSizeBytes ||
    before.dmgbuildVersion !== after.dmgbuildVersion ||
    before.dmgbuildSha256 !== after.dmgbuildSha256 ||
    before.dmgbuildSizeBytes !== after.dmgbuildSizeBytes
  ) {
    throw new Error("Mac package build inputs changed while the package was being built.")
  }
}

export function createInternalMacBuildEnvironment(
  env: NodeJS.ProcessEnv,
  input: {
    modelsSnapshot: string
    bundledGitDirectory: string
    home: string
    sourceDateEpoch: number
    dmgbuildExecutable: string
    bunExecutable?: string
  },
) {
  if (env.GUAI_CODE_BUNDLED_GIT_DIR?.trim()) {
    throw new Error("GUAI_CODE_BUNDLED_GIT_DIR is not allowed for internal Mac packages.")
  }
  if (env.CUSTOM_DMGBUILD_PATH?.trim()) {
    throw new Error("CUSTOM_DMGBUILD_PATH is not allowed for internal Mac packages.")
  }
  const inherited = ["SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"]
  return {
    ...Object.fromEntries(inherited.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]]))),
    PATH: `${path.join(input.bundledGitDirectory, "bin")}:${path.dirname(input.bunExecutable ?? process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: input.home,
    TMPDIR: path.join(input.home, "tmp"),
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    SOURCE_DATE_EPOCH: String(input.sourceDateEpoch),
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    BUN_INSTALL_CACHE_DIR: path.join(homedir(), ".bun", "install", "cache"),
    OPENCODE_CHANNEL: "beta",
    OPENCODE_UPDATER_ENABLED: "false",
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    MODELS_DEV_API_JSON: input.modelsSnapshot,
    GUAI_CODE_BUNDLED_GIT_DIR: input.bundledGitDirectory,
    CUSTOM_DMGBUILD_PATH: input.dmgbuildExecutable,
  }
}

type InternalMacLockOptions = {
  pid?: number
  hostname?: string
  now?: () => number
  isProcessRunning?: (pid: number) => boolean
}

export async function withInternalMacDeliveryLock<A>(
  lockPath: string,
  task: () => Promise<A>,
  options: InternalMacLockOptions = {},
) {
  await mkdir(path.dirname(lockPath), { recursive: true })
  const owner = {
    token: crypto.randomUUID(),
    pid: options.pid ?? process.pid,
    hostname: options.hostname ?? hostname(),
    startedAt: new Date((options.now ?? Date.now)()).toISOString(),
  }
  const isProcessRunning =
    options.isProcessRunning ??
    ((pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM"
      }
    })

  while (true) {
    const acquired = await mkdir(lockPath).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") return false
        throw error
      },
    )
    if (acquired) break

    const existing = (await Bun.file(path.join(lockPath, "owner.json"))
      .json()
      .catch(() => undefined)) as { pid?: unknown; hostname?: unknown } | undefined
    const lockAge = (options.now ?? Date.now)() - (await stat(lockPath)).mtimeMs
    const active =
      existing?.hostname === owner.hostname && typeof existing.pid === "number" && isProcessRunning(existing.pid)
    if (active || lockAge < 10 * 60 * 1000) {
      throw new Error(`Another internal Mac package is already running: ${lockPath}`)
    }

    const stale = `${lockPath}.stale-${crypto.randomUUID()}`
    const reclaimed = await rename(lockPath, stale).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false
        throw error
      },
    )
    if (!reclaimed) continue
    await rm(stale, { recursive: true, force: true })
  }
  await Bun.write(path.join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`)
  try {
    return await task()
  } finally {
    const current = (await Bun.file(path.join(lockPath, "owner.json"))
      .json()
      .catch(() => undefined)) as { token?: unknown } | undefined
    if (current?.token === owner.token) await rm(lockPath, { recursive: true, force: true })
  }
}

export async function publishInternalMacDelivery(
  stagingDirectory: string,
  destination: string,
  validate: () => Promise<void> = async () => undefined,
) {
  await recoverInternalMacDelivery(destination)
  const previous = `${destination}.previous`
  const journal = `${destination}.publish.json`
  const existing = await stat(destination).then(
    () => true,
    () => false,
  )
  const writeJournal = async (phase: "prepared" | "previous-moved" | "published" | "validated") => {
    const temporary = `${journal}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, `${JSON.stringify({ schemaVersion: 1, phase, existing })}\n`)
    await rename(temporary, journal)
  }

  await writeJournal("prepared")
  try {
    if (existing) await rename(destination, previous)
    await writeJournal("previous-moved")
    await rename(stagingDirectory, destination)
    await writeJournal("published")
    await validate()
    await writeJournal("validated")
    if (existing) await rm(previous, { recursive: true, force: true })
    await rm(journal, { force: true })
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    if (existing && (await pathExists(previous))) await rename(previous, destination)
    await rm(journal, { force: true })
    throw error
  }
}

export async function recoverInternalMacDelivery(destination: string) {
  const previous = `${destination}.previous`
  const journal = `${destination}.publish.json`
  const transaction = (await Bun.file(journal)
    .json()
    .catch(() => undefined)) as { phase?: unknown; existing?: unknown } | undefined
  const destinationExists = await pathExists(destination)
  const previousExists = await pathExists(previous)

  if (!transaction) {
    if (!destinationExists && previousExists) await rename(previous, destination)
    if (destinationExists && previousExists) await rm(previous, { recursive: true, force: true })
    return
  }

  if (transaction.phase === "validated" && destinationExists) {
    await rm(previous, { recursive: true, force: true })
    await rm(journal, { force: true })
    return
  }

  if (transaction.existing === true && previousExists) {
    await rm(destination, { recursive: true, force: true })
    await rename(previous, destination)
  }
  if (transaction.existing !== true) await rm(destination, { recursive: true, force: true })
  await rm(journal, { force: true })
}

async function pathExists(target: string) {
  return stat(target).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false
      throw error
    },
  )
}

export async function readInternalMacSourceProvenance(root: string): Promise<InternalMacSourceProvenance> {
  const commit = await readGitValue(root, ["rev-parse", "--verify", "HEAD"])
  const tree = await readGitValue(root, ["rev-parse", "--verify", `${commit}^{tree}`])
  const branch = await readGitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"])
  const commitTimestamp = new Date(await readGitValue(root, ["show", "-s", "--format=%cI", commit])).toISOString()
  const trackedStatus = await readGitValue(root, ["status", "--porcelain=v1", "--untracked-files=no"])
  const untrackedFiles = await readGitValue(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  const verifiedCommit = await readGitValue(root, ["rev-parse", "--verify", "HEAD"])
  if (commit !== verifiedCommit) throw new Error("Git HEAD changed while build provenance was being captured.")
  return {
    commit,
    tree,
    branch,
    commitTimestamp,
    trackedClean: trackedStatus.length === 0,
    untrackedFilesPresent: untrackedFiles.length > 0,
  }
}

function assertGitObjectID(value: string, label: string) {
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid Git ${label} object ID`)
}

function assertSha256(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid ${label} SHA-256`)
}

async function packageInternalMac() {
  assertInternalMacHost(process.platform, process.arch)
  const packageDir = path.resolve(import.meta.dirname, "..")
  const root = path.resolve(packageDir, "../..")
  const cachedModels = path.join(homedir(), ".cache", "opencode", "models.json")
  const sourceBeforeBuild = await readInternalMacSourceProvenance(root)
  assertInternalMacSourceReady(sourceBeforeBuild)
  const buildTimestamp = sourceBeforeBuild.commitTimestamp
  const modelsSource = process.env.MODELS_DEV_API_JSON || cachedModels
  if (!(await Bun.file(modelsSource).exists())) {
    throw new Error("Internal Mac packages require a MODELS_DEV_API_JSON file or the cached models.dev snapshot.")
  }
  const buildDirectory = path.join(
    tmpdir(),
    `guai-code-mac-build-${sourceBeforeBuild.commit.slice(0, 12)}-${crypto.randomUUID()}`,
  )
  const isolatedRoot = path.join(buildDirectory, "source")
  const isolatedPackageDir = path.join(isolatedRoot, "packages", "desktop")
  const modelsSnapshot = path.join(buildDirectory, "inputs", "models.json")
  const bundledGitDirectory = path.join(buildDirectory, "inputs", "git")
  const dmgbuildDirectory = path.join(buildDirectory, "inputs", "dmgbuild")
  const buildBunExecutable = path.join(buildDirectory, "inputs", "bun", "bun")
  const buildHome = path.join(buildDirectory, "home")
  const plan = createInternalMacArtifactPlan(isolatedPackageDir, pkg.version, process.arch, packageDir)
  const stagingDirectory = path.join(path.dirname(plan.directory), `.${pkg.version}.staging-${crypto.randomUUID()}`)
  const stagingPlan = createInternalMacArtifactPlan(
    isolatedPackageDir,
    pkg.version,
    process.arch,
    packageDir,
    stagingDirectory,
  )
  const lockPath = path.join(path.dirname(plan.directory), `.${pkg.version}.package.lock`)
  const sourceElectronDist = getInternalMacElectronDist(packageDir)

  await withInternalMacDeliveryLock(lockPath, async () => {
    try {
      await exportInternalMacSource(root, sourceBeforeBuild.commit, isolatedRoot)
      await Promise.all([
        mkdir(path.dirname(modelsSnapshot), { recursive: true }),
        mkdir(path.dirname(buildBunExecutable), { recursive: true }),
      ])
      await Promise.all([copyFile(modelsSource, modelsSnapshot), copyFile(process.execPath, buildBunExecutable)])
      await chmod(buildBunExecutable, (await lstat(process.execPath)).mode & 0o7777)
      await Promise.all([
        mkdir(path.join(buildHome, "tmp"), { recursive: true }),
        mkdir(path.join(buildHome, ".cache"), { recursive: true }),
      ])
      const git = await prepareInternalMacGit({
        cacheDirectory: path.join(homedir(), ".cache", "guai-code", "internal-package"),
        destination: bundledGitDirectory,
      })
      const dmgbuild = await prepareInternalMacDmgbuild({
        cacheDirectory: path.join(homedir(), ".cache", "guai-code", "internal-package"),
        destination: dmgbuildDirectory,
      })
      await Promise.all([
        normalizeInternalMacTimestamps(modelsSnapshot, buildTimestamp),
        normalizeInternalMacTimestamps(bundledGitDirectory, buildTimestamp),
        normalizeInternalMacTimestamps(dmgbuildDirectory, buildTimestamp),
        normalizeInternalMacTimestamps(buildBunExecutable, buildTimestamp),
      ])
      const guideTemplate = path.join(isolatedRoot, "docs", "product", "internal-beta-testing.md")
      if (!(await Bun.file(guideTemplate).exists())) {
        throw new Error(`Internal Mac tester guide is required: ${guideTemplate}`)
      }
      const buildEnvironment = createInternalMacBuildEnvironment(process.env, {
        modelsSnapshot,
        bundledGitDirectory,
        home: buildHome,
        sourceDateEpoch: Math.floor(Date.parse(sourceBeforeBuild.commitTimestamp) / 1000),
        dmgbuildExecutable: dmgbuild.executable,
        bunExecutable: buildBunExecutable,
      })

      if (!(await stat(sourceElectronDist)).isDirectory()) {
        throw new Error(`Installed Electron runtime is required: ${sourceElectronDist}`)
      }
      const sourceElectronSha256 = await sha256Directory(sourceElectronDist)
      await runCommand([buildBunExecutable, "install", "--frozen-lockfile", "--backend=copyfile"], {
        cwd: isolatedRoot,
        env: buildEnvironment,
      })
      await rm(getInternalMacElectronDist(isolatedPackageDir), { recursive: true, force: true })
      await cp(sourceElectronDist, getInternalMacElectronDist(isolatedPackageDir), {
        recursive: true,
      })
      await normalizeInternalMacTimestamps(getInternalMacElectronDist(isolatedPackageDir), buildTimestamp)
      await normalizeInternalMacTimestamps(isolatedRoot, buildTimestamp)
      const inputs = await readInternalMacBuildInputs(
        modelsSnapshot,
        getInternalMacElectronDist(isolatedPackageDir),
        git.archive,
        buildBunExecutable,
        dmgbuild.archive,
      )
      await runCommand([buildBunExecutable, "./scripts/prebuild.ts"], {
        cwd: isolatedPackageDir,
        env: buildEnvironment,
      })
      await normalizeInternalMacTimestamps(isolatedRoot, buildTimestamp)
      await runCommand([buildBunExecutable, "run", "electron-vite", "build"], {
        cwd: isolatedPackageDir,
        env: buildEnvironment,
      })
      await normalizeInternalMacTimestamps(isolatedRoot, buildTimestamp)
      await buildInternalMacArtifacts({
        bunExecutable: buildBunExecutable,
        electronDist: getInternalMacElectronDist(isolatedPackageDir),
        appBundle: plan.app,
        builderDmg: plan.builderDmg,
        builderZip: plan.builderZip,
        buildTimestamp,
        cwd: isolatedPackageDir,
        env: buildEnvironment,
      })

      await runCommand(["codesign", "--verify", "--deep", "--strict", "--verbose=2", plan.app], {
        env: buildEnvironment,
      })
      assertInternalMacBuildInputsUnchanged(
        inputs,
        await readInternalMacBuildInputs(
          modelsSnapshot,
          getInternalMacElectronDist(isolatedPackageDir),
          git.archive,
          buildBunExecutable,
          dmgbuild.archive,
        ),
      )
      assertInternalMacSourceUnchanged(sourceBeforeBuild, await readInternalMacSourceProvenance(root))
      if ((await sha256Directory(sourceElectronDist)) !== sourceElectronSha256) {
        throw new Error("Installed Electron runtime changed while the package was being built.")
      }
      const buildInfo = createInternalMacBuildMetadata({
        version: pkg.version,
        arch: process.arch,
        source: sourceBeforeBuild,
        buildTimestamp,
        inputs,
      })

      await mkdir(stagingPlan.directory, { recursive: true })
      await Promise.all([
        copyFile(plan.builderDmg, stagingPlan.dmg),
        copyFile(plan.builderZip, stagingPlan.zip),
        copyFile(path.join(isolatedRoot, "LICENSE"), stagingPlan.license),
        copyFile(git.license, stagingPlan.gitLicense),
        Bun.write(stagingPlan.buildInfo, `${JSON.stringify(buildInfo, null, 2)}\n`),
        Bun.write(stagingPlan.guide, renderInternalMacGuide(await Bun.file(guideTemplate).text(), pkg.version)),
      ])
      await verifyInternalMacDeliveryArtifacts(stagingPlan)
      const deliveryFiles = getInternalMacDeliveryFiles(stagingPlan)
      await Bun.write(
        stagingPlan.checksums,
        formatChecksumManifest(
          await Promise.all(deliveryFiles.map(async (file) => ({ file, sha256: await sha256(file) }))),
        ),
      )
      await verifyInternalMacChecksumManifest(stagingPlan.checksums, deliveryFiles)
      assertInternalMacSourceUnchanged(sourceBeforeBuild, await readInternalMacSourceProvenance(root))
      await publishInternalMacDelivery(stagingPlan.directory, plan.directory, async () => {
        await verifyInternalMacDeliveryArtifacts(plan)
        await verifyInternalMacChecksumManifest(plan.checksums, getInternalMacDeliveryFiles(plan))
        await verifyInternalMacPackagedZip(plan.zip)
      })
    } finally {
      await Promise.all([
        rm(buildDirectory, { recursive: true, force: true }),
        rm(stagingPlan.directory, { recursive: true, force: true }),
      ])
    }
  })

  console.log(`Internal Beta package ready: ${plan.directory}`)
}

if (import.meta.main) await packageInternalMac()

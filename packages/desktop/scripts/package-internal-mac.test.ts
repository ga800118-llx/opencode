import { describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, mkdtemp, readlink, readdir, rm, stat, symlink, utimes } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import pkg from "../package.json"
import { formatChecksumManifest } from "./internal-package"
import {
  assertInternalMacBuildInputsUnchanged,
  assertInternalMacHost,
  assertInternalMacSourceReady,
  assertInternalMacSourceUnchanged,
  assertMacGitArchive,
  assertMacGitLicense,
  assertMacDmgbuildArchive,
  buildInternalMacArtifacts,
  createMacGitDownloadCommand,
  createInternalMacArtifactPlan,
  createInternalMacBuildMetadata,
  createInternalMacBuildEnvironment,
  createInternalMacSmokeEnvironment,
  downloadVerifiedInternalMacFile,
  exportInternalMacSource,
  getInternalMacDeliveryFiles,
  getInternalMacElectronDist,
  normalizeInternalMacTimestamps,
  readInternalMacBuildInputs,
  readInternalMacSourceProvenance,
  recoverInternalMacDelivery,
  renderInternalMacGuide,
  publishInternalMacDelivery,
  sha256Directory,
  assertInternalMacSidecarGitTrace,
  assertInternalMacSmokeEvidence,
  verifyInternalMacChecksumManifest,
  verifyInternalMacBundledGit,
  verifyInternalMacDeliveryArtifacts,
  verifyInternalMacPackagedApp,
  verifyInternalMacPackagedZip,
  withInternalMacDeliveryLock,
  MAC_GIT_ASSET,
  MAC_GIT_LICENSE_SHA256,
  MAC_GIT_LICENSE_SIZE_BYTES,
  MAC_GIT_RELEASE,
  MAC_GIT_SHA256,
  MAC_GIT_SIZE_BYTES,
  MAC_GIT_URL,
  MAC_GIT_VERSION,
  MAC_DMGBUILD_ASSET,
  MAC_DMGBUILD_RELEASE,
  MAC_DMGBUILD_SHA256,
  MAC_DMGBUILD_SIZE_BYTES,
  MAC_DMGBUILD_URL,
  MAC_DMGBUILD_VERSION,
} from "./package-internal-mac"

const guidePath = path.join(import.meta.dir, "..", "..", "..", "docs", "product", "internal-beta-testing.md")

async function git(directory: string, ...args: string[]) {
  const child = Bun.spawn(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(stderr.trim())
  return stdout.trim()
}

describe("internal Mac package", () => {
  test("plans versioned Apple Silicon artifacts", () => {
    const plan = createInternalMacArtifactPlan("/repo/packages/desktop", pkg.version, "arm64")

    expect(plan.app).toBe(path.join("/repo/packages/desktop", "dist", "mac-arm64", "Guai Code Beta.app"))
    expect(plan.builderDmg).toBe(
      path.join("/repo/packages/desktop", "dist", `guai-code-desktop-beta-${pkg.version}-mac-arm64.dmg`),
    )
    expect(plan.builderZip).toBe(
      path.join("/repo/packages/desktop", "dist", `guai-code-desktop-beta-${pkg.version}-mac-arm64.zip`),
    )
    expect(plan.directory).toBe(path.join("/repo/packages/desktop", "dist", "internal-beta", pkg.version))
    expect(path.basename(plan.dmg)).toBe(`Guai-Code-Beta-${pkg.version}-mac-arm64.dmg`)
    expect(path.basename(plan.zip)).toBe(`Guai-Code-Beta-${pkg.version}-mac-arm64.zip`)
    expect(path.basename(plan.buildInfo)).toBe("BUILD-INFO.json")
  })

  test("rejects unsupported package hosts", () => {
    expect(() => assertInternalMacHost("darwin", "arm64")).not.toThrow()
    expect(() => assertInternalMacHost("darwin", "x64")).toThrow("Apple Silicon")
    expect(() => assertInternalMacHost("win32", "arm64")).toThrow("macOS")
  })

  test("uses the installed Electron runtime without a release download", () => {
    expect(getInternalMacElectronDist("/repo/packages/desktop")).toBe(
      path.join("/repo/packages/desktop", "node_modules", "electron", "dist"),
    )
  })

  test("pins and verifies the official relocatable Mac Git distribution", () => {
    expect(MAC_GIT_RELEASE).toBe("v2.53.0-4")
    expect(MAC_GIT_ASSET).toBe("dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz")
    expect(MAC_GIT_URL).toBe(
      "https://github.com/desktop/dugite-native/releases/download/v2.53.0-4/dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz",
    )
    expect(() => assertMacGitArchive(MAC_GIT_SIZE_BYTES, MAC_GIT_SHA256)).not.toThrow()
    expect(() => assertMacGitArchive(MAC_GIT_SIZE_BYTES + 1, MAC_GIT_SHA256)).toThrow("size mismatch")
    expect(() => assertMacGitArchive(MAC_GIT_SIZE_BYTES, "0".repeat(64))).toThrow("checksum mismatch")
    expect(() => assertMacGitLicense(MAC_GIT_LICENSE_SIZE_BYTES, MAC_GIT_LICENSE_SHA256)).not.toThrow()
    expect(() => assertMacGitLicense(MAC_GIT_LICENSE_SIZE_BYTES, "0".repeat(64))).toThrow("checksum mismatch")
  })

  test("downloads Mac Git with an explicit native timeout", () => {
    expect(createMacGitDownloadCommand("/tmp/git.tar.gz")).toEqual([
      "/usr/bin/curl",
      "--fail",
      "--location",
      "--show-error",
      "--progress-bar",
      "--connect-timeout",
      "30",
      "--output",
      "/tmp/git.tar.gz",
      MAC_GIT_URL,
    ])
  })

  test("pins and verifies the official Mac dmgbuild distribution", () => {
    expect(MAC_DMGBUILD_RELEASE).toBe("dmg-builder@1.2.5")
    expect(MAC_DMGBUILD_ASSET).toBe("dmgbuild-bundle-arm64-75c8a6c.tar.gz")
    expect(MAC_DMGBUILD_URL).toBe(
      "https://github.com/electron-userland/electron-builder-binaries/releases/download/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c.tar.gz",
    )
    expect(() => assertMacDmgbuildArchive(MAC_DMGBUILD_SIZE_BYTES, MAC_DMGBUILD_SHA256)).not.toThrow()
    expect(() => assertMacDmgbuildArchive(MAC_DMGBUILD_SIZE_BYTES + 1, MAC_DMGBUILD_SHA256)).toThrow("size mismatch")
    expect(() => assertMacDmgbuildArchive(MAC_DMGBUILD_SIZE_BYTES, "0".repeat(64))).toThrow("checksum mismatch")
  })

  test("promotes only verified Mac Git downloads and cleans failed temporary files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-git-download-"))
    const archive = path.join(directory, "git.tar.gz")
    const content = "verified portable git"
    const checksum = new Bun.CryptoHasher("sha256").update(content).digest("hex")
    const commands: readonly string[][] = []

    await downloadVerifiedInternalMacFile({
      archive,
      url: "https://example.invalid/git.tar.gz",
      size: Buffer.byteLength(content),
      checksum,
      label: "Test Git",
      options: {
        attempts: 1,
        run: async (command) => {
          commands.push([...command])
          await Bun.write(command[command.indexOf("--output") + 1], content)
        },
        log: () => undefined,
      },
    })
    expect(await Bun.file(archive).text()).toBe(content)
    expect(commands).toHaveLength(1)

    await Bun.write(archive, "corrupt")
    await expect(
      downloadVerifiedInternalMacFile({
        archive,
        url: "https://example.invalid/git.tar.gz",
        size: Buffer.byteLength(content),
        checksum,
        label: "Test Git",
        options: {
          attempts: 1,
          run: async () => {
            throw new Error("offline")
          },
          log: () => undefined,
        },
      }),
    ).rejects.toThrow("download failed after 1 attempts")
    expect(await Bun.file(archive).exists()).toBeFalse()
    expect((await readdir(directory)).some((file) => file.endsWith(".download"))).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("retries integrity failures and removes the damaged download before the next attempt", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-git-integrity-retry-"))
    const archive = path.join(directory, "git.tar.gz")
    const content = "verified portable git"
    const checksum = new Bun.CryptoHasher("sha256").update(content).digest("hex")
    const attempts: readonly string[][] = []
    const delays: number[] = []
    const logs: string[] = []

    await downloadVerifiedInternalMacFile({
      archive,
      url: "https://example.invalid/git.tar.gz",
      size: Buffer.byteLength(content),
      checksum,
      label: "Test Git",
      options: {
        attempts: 2,
        retryDelayMs: 17,
        run: async (command) => {
          attempts.push([...command])
          await Bun.write(command[command.indexOf("--output") + 1], attempts.length === 1 ? "damaged" : content)
        },
        delay: async (milliseconds) => {
          delays.push(milliseconds)
          expect((await readdir(directory)).some((file) => file.endsWith(".download"))).toBeFalse()
        },
        log: (message) => logs.push(message),
      },
    })

    expect(attempts).toHaveLength(2)
    expect(delays).toEqual([17])
    expect(logs).toContain("[Test Git] Download attempt 1/2")
    expect(logs).toContain("[Test Git] Download attempt 2/2")
    expect(logs.some((message) => message.includes("integrity mismatch"))).toBeTrue()
    expect(await Bun.file(archive).text()).toBe(content)
    expect((await readdir(directory)).some((file) => file.endsWith(".download"))).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("formats a stable checksum manifest", () => {
    expect(
      formatChecksumManifest([
        { file: "/tmp/Guai-Code-Beta.zip", sha256: "b".repeat(64) },
        { file: "/tmp/Guai-Code-Beta.dmg", sha256: "a".repeat(64) },
      ]),
    ).toBe(`${"a".repeat(64)}  Guai-Code-Beta.dmg\n${"b".repeat(64)}  Guai-Code-Beta.zip\n`)
  })

  test("records a committed tracked-clean Git tree without leaking untracked paths", () => {
    const privatePath = "/private/worktree/customer-secret.txt"
    expect(
      createInternalMacBuildMetadata({
        version: pkg.version,
        arch: "arm64",
        source: {
          commit: "a".repeat(40),
          tree: "b".repeat(40),
          branch: "codex/phase-0-3",
          commitTimestamp: "2026-08-12T01:02:03.000Z",
          trackedClean: true,
          untrackedFilesPresent: true,
        },
        buildTimestamp: "2026-08-12T01:02:03.000Z",
        inputs: {
          modelsSha256: "c".repeat(64),
          electronVersion: "42.3.3",
          electronSha256: "d".repeat(64),
          bunVersion: "1.2.22",
          bunSha256: "e".repeat(64),
          gitVersion: MAC_GIT_VERSION,
          gitSha256: MAC_GIT_SHA256,
          gitSizeBytes: MAC_GIT_SIZE_BYTES,
          dmgbuildVersion: MAC_DMGBUILD_VERSION,
          dmgbuildSha256: MAC_DMGBUILD_SHA256,
          dmgbuildSizeBytes: MAC_DMGBUILD_SIZE_BYTES,
        },
      }),
    ).toEqual({
      schemaVersion: 5,
      product: "Guai Code Beta",
      channel: "beta",
      version: "0.1.0-alpha.2",
      platform: "darwin",
      arch: "arm64",
      source: {
        vcs: "git",
        commit: "a".repeat(40),
        tree: "b".repeat(40),
        branch: "codex/phase-0-3",
        commitTimestamp: "2026-08-12T01:02:03.000Z",
        trackedClean: true,
        untrackedFilesPresent: true,
        buildMode: "isolated-git-archive",
      },
      inputs: {
        models: {
          format: "models.dev-json",
          sha256: "c".repeat(64),
        },
        electron: {
          version: "42.3.3",
          sha256: "d".repeat(64),
        },
        bun: {
          version: "1.2.22",
          sha256: "e".repeat(64),
        },
        git: {
          distribution: "desktop/dugite-native",
          release: MAC_GIT_RELEASE,
          version: MAC_GIT_VERSION,
          sha256: MAC_GIT_SHA256,
          sizeBytes: MAC_GIT_SIZE_BYTES,
        },
        dmgbuild: {
          distribution: "electron-userland/electron-builder-binaries",
          release: MAC_DMGBUILD_RELEASE,
          version: MAC_DMGBUILD_VERSION,
          sha256: MAC_DMGBUILD_SHA256,
          sizeBytes: MAC_DMGBUILD_SIZE_BYTES,
        },
      },
      buildTimestamp: "2026-08-12T01:02:03.000Z",
    })
    expect(
      JSON.stringify(
        createInternalMacBuildMetadata({
          version: pkg.version,
          arch: "arm64",
          source: {
            commit: "a".repeat(40),
            tree: "b".repeat(40),
            branch: "HEAD",
            commitTimestamp: "2026-08-12T01:02:03.000Z",
            trackedClean: true,
            untrackedFilesPresent: privatePath.length > 0,
          },
          buildTimestamp: "2026-08-12T01:02:03.000Z",
          inputs: {
            modelsSha256: "c".repeat(64),
            electronVersion: "42.3.3",
            electronSha256: "d".repeat(64),
            bunVersion: "1.2.22",
            bunSha256: "e".repeat(64),
            gitVersion: MAC_GIT_VERSION,
            gitSha256: MAC_GIT_SHA256,
            gitSizeBytes: MAC_GIT_SIZE_BYTES,
            dmgbuildVersion: MAC_DMGBUILD_VERSION,
            dmgbuildSha256: MAC_DMGBUILD_SHA256,
            dmgbuildSizeBytes: MAC_DMGBUILD_SIZE_BYTES,
          },
        }),
      ),
    ).not.toContain(privatePath)
  })

  test("exports exactly the committed source without untracked or modified files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-source-"))
    const repository = path.join(directory, "repository")
    const exported = path.join(directory, "exported")
    await mkdir(repository, { recursive: true })
    await git(repository, "init", "--quiet")
    await git(repository, "config", "user.email", "package-test@example.invalid")
    await git(repository, "config", "user.name", "Package Test")
    await Bun.write(path.join(repository, "tracked.txt"), "committed\n")
    await git(repository, "add", "tracked.txt")
    await git(repository, "commit", "--quiet", "-m", "test: seed")
    const commit = await git(repository, "rev-parse", "HEAD")
    await Bun.write(path.join(repository, "tracked.txt"), "working tree change\n")
    await Bun.write(path.join(repository, "private-untracked.txt"), "private\n")

    await exportInternalMacSource(repository, commit, exported)

    expect(await Bun.file(path.join(exported, "tracked.txt")).text()).toBe("committed\n")
    expect(await Bun.file(path.join(exported, "private-untracked.txt")).exists()).toBeFalse()
    expect(await Bun.file(path.join(exported, ".git")).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("hashes the complete Electron runtime and model snapshot deterministically", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-inputs-"))
    const electron = path.join(directory, "electron")
    const models = path.join(directory, "models.json")
    await mkdir(path.join(electron, "nested"), { recursive: true })
    await Bun.write(path.join(electron, "version"), "42.3.3\n")
    await Bun.write(path.join(electron, "nested", "runtime.bin"), "runtime-v1")
    await Bun.write(models, '{"provider":{}}\n')

    const first = await readInternalMacBuildInputs(models, electron)
    expect(first).toEqual({
      modelsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      electronVersion: "42.3.3",
      electronSha256: await sha256Directory(electron),
      bunVersion: Bun.version,
      bunSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      gitVersion: MAC_GIT_VERSION,
      gitSha256: MAC_GIT_SHA256,
      gitSizeBytes: MAC_GIT_SIZE_BYTES,
      dmgbuildVersion: MAC_DMGBUILD_VERSION,
      dmgbuildSha256: MAC_DMGBUILD_SHA256,
      dmgbuildSizeBytes: MAC_DMGBUILD_SIZE_BYTES,
    })
    expect(await sha256Directory(electron)).toBe(first.electronSha256)

    await Bun.write(path.join(electron, "nested", "runtime.bin"), "runtime-v2")
    expect(await sha256Directory(electron)).not.toBe(first.electronSha256)
    const contentHash = await sha256Directory(electron)
    await chmod(path.join(electron, "nested", "runtime.bin"), 0o755)
    expect(await sha256Directory(electron)).not.toBe(contentHash)
    await rm(directory, { recursive: true, force: true })
  })

  test("normalizes archive input timestamps recursively without changing contents, modes, or links", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-timestamps-"))
    const nested = path.join(directory, "runtime")
    const executable = path.join(nested, "bin")
    const link = path.join(nested, "current")
    const timestamp = "2024-02-03T04:05:06.000Z"
    await mkdir(nested, { recursive: true })
    await Bun.write(executable, "runtime")
    await chmod(executable, 0o755)
    await symlink("bin", link)
    await utimes(executable, new Date("2025-01-01T00:00:00.000Z"), new Date("2025-01-01T00:00:00.000Z"))

    await normalizeInternalMacTimestamps(directory, timestamp)

    const expected = Date.parse(timestamp)
    for (const target of [directory, nested, executable, link]) {
      expect(Math.round((await lstat(target)).atimeMs)).toBe(expected)
      expect(Math.round((await lstat(target)).mtimeMs)).toBe(expected)
    }
    expect(await Bun.file(executable).text()).toBe("runtime")
    expect((await lstat(executable)).mode & 0o777).toBe(0o755)
    expect(await readlink(link)).toBe("bin")

    await utimes(executable, new Date(), new Date())
    await normalizeInternalMacTimestamps(directory, timestamp)
    expect(Math.round((await lstat(executable)).mtimeMs)).toBe(expected)
    await expect(normalizeInternalMacTimestamps(directory, "not-a-timestamp")).rejects.toThrow(
      "Invalid source commit timestamp",
    )
    await rm(directory, { recursive: true, force: true })
  })

  test("normalizes the signed app before archiving it as a prepackaged ZIP and DMG", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-prepackaged-"))
    const app = path.join(directory, "dist", "mac-arm64", "Guai Code Beta.app")
    const executable = path.join(app, "Contents", "MacOS", "Guai Code Beta")
    const dmg = path.join(directory, "dist", "guai-code.dmg")
    const zip = path.join(directory, "dist", "guai-code.zip")
    const timestamp = "2024-02-03T04:05:06.000Z"
    const commands: readonly string[][] = []

    await buildInternalMacArtifacts(
      {
        bunExecutable: "/isolated/toolchain/bin/bun",
        electronDist: "/isolated/source/packages/desktop/node_modules/electron/dist",
        appBundle: app,
        builderDmg: dmg,
        builderZip: zip,
        buildTimestamp: timestamp,
        cwd: directory,
        env: { SOURCE_DATE_EPOCH: String(Date.parse(timestamp) / 1000) },
      },
      async (command) => {
        commands.push([...command])
        if (commands.length === 1) {
          await Bun.write(executable, "signed app")
          await utimes(executable, new Date(), new Date())
          return
        }
        expect(Math.round((await lstat(app)).mtimeMs)).toBe(Date.parse(timestamp))
        expect(Math.round((await lstat(executable)).mtimeMs)).toBe(Date.parse(timestamp))
        await Promise.all([Bun.write(dmg, "dmg"), Bun.write(zip, "zip")])
      },
    )

    expect(commands).toEqual([
      [
        "/isolated/toolchain/bin/bun",
        "run",
        "electron-builder",
        "--mac",
        "--dir",
        "--publish",
        "never",
        "--config",
        "electron-builder.config.ts",
        "--config.electronDist=/isolated/source/packages/desktop/node_modules/electron/dist",
      ],
      [
        "/isolated/toolchain/bin/bun",
        "run",
        "electron-builder",
        "--mac",
        "dmg",
        "zip",
        "--prepackaged",
        app,
        "--publish",
        "never",
        "--config",
        "electron-builder.config.ts",
      ],
    ])
    await rm(directory, { recursive: true, force: true })
  })

  test("rejects an archiver that mutates the normalized prepackaged app", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-prepackaged-mutation-"))
    const app = path.join(directory, "dist", "mac-arm64", "Guai Code Beta.app")
    const executable = path.join(app, "Contents", "MacOS", "Guai Code Beta")
    let invocation = 0

    await expect(
      buildInternalMacArtifacts(
        {
          bunExecutable: "/isolated/bin/bun",
          electronDist: "/isolated/electron",
          appBundle: app,
          builderDmg: path.join(directory, "dist", "guai-code.dmg"),
          builderZip: path.join(directory, "dist", "guai-code.zip"),
          buildTimestamp: "2024-02-03T04:05:06.000Z",
          cwd: directory,
          env: {},
        },
        async () => {
          invocation += 1
          if (invocation === 1) {
            await Bun.write(executable, "signed app")
            return
          }
          await utimes(executable, new Date(), new Date())
        },
      ),
    ).rejects.toThrow(`Prepackaged application timestamps changed while creating ZIP/DMG`)
    expect(invocation).toBe(2)
    await rm(directory, { recursive: true, force: true })
  })

  test("normalizes isolated source and copied runtimes to the source commit timestamp", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "package-internal-mac.ts")).text()

    expect(source).toContain("copyFile(process.execPath, buildBunExecutable)")
    expect(source).toContain('[buildBunExecutable, "install", "--frozen-lockfile", "--backend=copyfile"]')
    expect(source).toContain("bunExecutable: buildBunExecutable")
    expect(source).toContain("normalizeInternalMacTimestamps(modelsSnapshot, buildTimestamp)")
    expect(source).toContain("normalizeInternalMacTimestamps(bundledGitDirectory, buildTimestamp)")
    expect(source).toContain("normalizeInternalMacTimestamps(buildBunExecutable, buildTimestamp)")
    expect(source).toContain(
      "normalizeInternalMacTimestamps(getInternalMacElectronDist(isolatedPackageDir), buildTimestamp)",
    )
    expect(source.match(/normalizeInternalMacTimestamps\(isolatedRoot, buildTimestamp\)/g)).toHaveLength(3)
  })

  test("rejects build inputs that change after their provenance is captured", () => {
    const before = {
      modelsSha256: "a".repeat(64),
      electronVersion: "42.3.3",
      electronSha256: "b".repeat(64),
      bunVersion: "1.2.22",
      bunSha256: "c".repeat(64),
      gitVersion: MAC_GIT_VERSION,
      gitSha256: MAC_GIT_SHA256,
      gitSizeBytes: MAC_GIT_SIZE_BYTES,
    }
    expect(() => assertInternalMacBuildInputsUnchanged(before, before)).not.toThrow()
    expect(() =>
      assertInternalMacBuildInputsUnchanged(before, {
        ...before,
        electronSha256: "d".repeat(64),
      }),
    ).toThrow("build inputs changed")
  })

  test("uses an isolated deterministic build environment and rejects external bundled Git", () => {
    const environment = createInternalMacBuildEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/Users/test",
        SENTRY_AUTH_TOKEN: "secret",
        SENTRY_ORG: "private-org",
        OPENCODE_UPDATER_ENABLED: "true",
        NODE_OPTIONS: "--require /private/hook.js",
      },
      {
        modelsSnapshot: "/tmp/models.json",
        bundledGitDirectory: "/tmp/git",
        home: "/tmp/home",
        sourceDateEpoch: 1_786_499_323,
        dmgbuildExecutable: "/tmp/dmgbuild/dmgbuild",
        bunExecutable: "/toolchain/bin/bun",
      },
    )
    expect(environment).toEqual({
      PATH: "/tmp/git/bin:/toolchain/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: "/tmp/home",
      TMPDIR: "/tmp/home/tmp",
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
      SOURCE_DATE_EPOCH: "1786499323",
      ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
      BUN_INSTALL_CACHE_DIR: path.join(homedir(), ".bun", "install", "cache"),
      OPENCODE_CHANNEL: "beta",
      OPENCODE_UPDATER_ENABLED: "false",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      MODELS_DEV_API_JSON: "/tmp/models.json",
      GUAI_CODE_BUNDLED_GIT_DIR: "/tmp/git",
      CUSTOM_DMGBUILD_PATH: "/tmp/dmgbuild/dmgbuild",
    })
    expect(() =>
      createInternalMacBuildEnvironment(
        { GUAI_CODE_BUNDLED_GIT_DIR: "/private/mingit" },
        {
          modelsSnapshot: "/tmp/models.json",
          bundledGitDirectory: "/tmp/git",
          home: "/tmp/home",
          sourceDateEpoch: 0,
          dmgbuildExecutable: "/tmp/dmgbuild/dmgbuild",
        },
      ),
    ).toThrow("not allowed")
    expect(() =>
      createInternalMacBuildEnvironment(
        { CUSTOM_DMGBUILD_PATH: "/private/dmgbuild" },
        {
          modelsSnapshot: "/tmp/models.json",
          bundledGitDirectory: "/tmp/git",
          home: "/tmp/home",
          sourceDateEpoch: 0,
          dmgbuildExecutable: "/tmp/dmgbuild/dmgbuild",
        },
      ),
    ).toThrow("not allowed")
  })

  test("locks one delivery version and publishes only complete staging directories", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-publish-"))
    const lock = path.join(directory, ".package.lock")
    let release = () => undefined
    let acquired = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const first = withInternalMacDeliveryLock(lock, async () => {
      acquired()
      await gate
    })
    await ready
    await expect(withInternalMacDeliveryLock(lock, async () => undefined)).rejects.toThrow("already running")
    release()
    await first

    const destination = path.join(directory, "release")
    const staging = path.join(directory, "staging")
    await mkdir(destination)
    await mkdir(staging)
    await Bun.write(path.join(destination, "old.txt"), "old")
    await Bun.write(path.join(staging, "new.txt"), "new")
    let validated = false
    await publishInternalMacDelivery(staging, destination, async () => {
      expect(await Bun.file(path.join(destination, "new.txt")).text()).toBe("new")
      validated = true
    })
    expect(validated).toBeTrue()
    expect(await Bun.file(path.join(destination, "new.txt")).text()).toBe("new")
    expect(await Bun.file(path.join(destination, "old.txt")).exists()).toBeFalse()
    expect(await Bun.file(staging).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("reclaims a stale lock and rolls back when published delivery validation fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-recovery-"))
    const lock = path.join(directory, ".package.lock")
    await mkdir(lock)
    await Bun.write(
      path.join(lock, "owner.json"),
      JSON.stringify({ token: "stale", pid: 12_345, hostname: "test-host", startedAt: "2020-01-01T00:00:00Z" }),
    )
    await withInternalMacDeliveryLock(lock, async () => undefined, {
      hostname: "test-host",
      now: () => Date.now() + 11 * 60 * 1000,
      isProcessRunning: () => false,
    })
    expect(await Bun.file(lock).exists()).toBeFalse()

    const destination = path.join(directory, "release")
    const staging = path.join(directory, "staging")
    await mkdir(destination)
    await mkdir(staging)
    await Bun.write(path.join(destination, "old.txt"), "old")
    await Bun.write(path.join(staging, "new.txt"), "new")
    await expect(
      publishInternalMacDelivery(staging, destination, async () => {
        throw new Error("final validation failed")
      }),
    ).rejects.toThrow("final validation failed")
    expect(await Bun.file(path.join(destination, "old.txt")).text()).toBe("old")
    expect(await Bun.file(path.join(destination, "new.txt")).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("recovers the previous complete delivery after an interrupted directory swap", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-interrupted-publish-"))
    const destination = path.join(directory, "release")
    const previous = `${destination}.previous`
    const journal = `${destination}.publish.json`
    await mkdir(previous)
    await Bun.write(path.join(previous, "old.txt"), "old")
    await Bun.write(journal, `${JSON.stringify({ schemaVersion: 1, phase: "previous-moved", existing: true })}\n`)

    await recoverInternalMacDelivery(destination)

    expect(await Bun.file(path.join(destination, "old.txt")).text()).toBe("old")
    expect(await Bun.file(previous).exists()).toBeFalse()
    expect(await Bun.file(journal).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("completes cleanup after an interrupted validated publish", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-validated-publish-"))
    const destination = path.join(directory, "release")
    const previous = `${destination}.previous`
    const journal = `${destination}.publish.json`
    await Promise.all([mkdir(destination), mkdir(previous)])
    await Bun.write(path.join(destination, "new.txt"), "new")
    await Bun.write(path.join(previous, "old.txt"), "old")
    await Bun.write(journal, `${JSON.stringify({ schemaVersion: 1, phase: "validated", existing: true })}\n`)

    await recoverInternalMacDelivery(destination)

    expect(await Bun.file(path.join(destination, "new.txt")).text()).toBe("new")
    expect(await Bun.file(previous).exists()).toBeFalse()
    expect(await Bun.file(journal).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("reads tracked and untracked source state from a real Git repository", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-provenance-"))
    await git(directory, "init", "--quiet")
    await git(directory, "config", "user.email", "package-test@example.invalid")
    await git(directory, "config", "user.name", "Package Test")
    await Bun.write(path.join(directory, "tracked.txt"), "committed\n")
    await git(directory, "add", "tracked.txt")
    await git(directory, "commit", "--quiet", "-m", "test: seed")
    await Bun.write(path.join(directory, "private-untracked.txt"), "do not disclose\n")

    const clean = await readInternalMacSourceProvenance(directory)

    expect(clean).toEqual({
      commit: await git(directory, "rev-parse", "HEAD"),
      tree: await git(directory, "rev-parse", "HEAD^{tree}"),
      branch: await git(directory, "rev-parse", "--abbrev-ref", "HEAD"),
      commitTimestamp: new Date(await git(directory, "show", "-s", "--format=%cI", "HEAD")).toISOString(),
      trackedClean: true,
      untrackedFilesPresent: true,
    })
    expect(JSON.stringify(clean)).not.toContain("private-untracked.txt")
    expect(() => assertInternalMacSourceReady(clean)).not.toThrow()

    await Bun.write(path.join(directory, "tracked.txt"), "modified\n")
    const dirty = await readInternalMacSourceProvenance(directory)
    expect(dirty.trackedClean).toBeFalse()
    expect(() => assertInternalMacSourceReady(dirty)).toThrow("no staged or unstaged tracked changes")

    await git(directory, "add", "tracked.txt")
    const staged = await readInternalMacSourceProvenance(directory)
    expect(staged.trackedClean).toBeFalse()
    expect(() => assertInternalMacSourceReady(staged)).toThrow("no staged or unstaged tracked changes")

    await rm(directory, { recursive: true, force: true })
  })

  test("rejects source changes that occur while packaging", () => {
    const before = {
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      branch: "release-beta",
      commitTimestamp: "2026-08-12T01:02:03.000Z",
      trackedClean: true,
      untrackedFilesPresent: true,
    }

    expect(() => assertInternalMacSourceUnchanged(before, before)).not.toThrow()
    expect(() =>
      assertInternalMacSourceUnchanged(before, {
        ...before,
        commit: "c".repeat(40),
        tree: "d".repeat(40),
      }),
    ).toThrow("changed while")
    expect(() => assertInternalMacSourceUnchanged(before, { ...before, trackedClean: false })).toThrow(
      "no staged or unstaged tracked changes",
    )
  })

  test("renders the tester guide from the package version", async () => {
    const template = await Bun.file(guidePath).text()
    const guide = renderInternalMacGuide(template, pkg.version)

    expect(template).toContain("{{VERSION}}")
    expect(template).not.toContain("0.1.0-alpha.1")
    expect(guide).toContain(`版本：\`${pkg.version}\``)
    expect(guide).not.toContain("{{VERSION}}")
    expect(() => renderInternalMacGuide("missing marker", pkg.version)).toThrow("{{VERSION}}")
  })

  test("verifies copied delivery artifacts rather than builder outputs", async () => {
    const plan = createInternalMacArtifactPlan("/repo/packages/desktop", pkg.version, "arm64")
    const commands: readonly string[][] = []

    await verifyInternalMacDeliveryArtifacts(plan, async (command) => commands.push([...command]))

    expect(commands).toEqual([
      ["/usr/bin/unzip", "-t", plan.zip],
      ["/usr/bin/hdiutil", "verify", plan.dmg],
    ])
    expect(commands.flat()).not.toContain(plan.builderZip)
    expect(commands.flat()).not.toContain(plan.builderDmg)
  })

  test("verifies the packaged relocatable Git runtime and license", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-git-runtime-"))
    const app = path.join(directory, "Guai Code Beta.app")
    const root = path.join(app, "Contents", "Resources", "mingit")
    const smoke = path.join(directory, "git-smoke")
    await Promise.all([
      Bun.write(path.join(root, "bin", "git"), "git"),
      Bun.write(path.join(root, "libexec", "git-core", "git"), "git-core"),
      Bun.write(path.join(root, "etc", "gitconfig"), "config"),
      mkdir(path.join(root, "share", "git-core", "templates"), { recursive: true }),
      Bun.write(path.join(root, "COPYING"), "GPLv2"),
    ])
    const invocations: Array<{
      command: readonly string[]
      options: { cwd?: string; env: Record<string, string> }
    }> = []
    const commit = "a".repeat(40)
    const repository = path.join(smoke, "repository")
    const worktree = path.join(smoke, "worktree")

    await verifyInternalMacBundledGit(app, {
      temporaryDirectory: smoke,
      run: async (command, options) => {
        invocations.push({ command: [...command], options })
        if (command.includes("--exec-path")) return { stdout: path.join(root, "libexec", "git-core"), stderr: "" }
        if (command.includes("worktree")) {
          await mkdir(worktree, { recursive: true })
          await Bun.write(path.join(worktree, "packaged-git-smoke.txt"), "packaged Git relocation smoke\n")
        }
        if (command.includes("--show-toplevel")) return { stdout: worktree, stderr: "" }
        if (command.includes("rev-parse")) return { stdout: commit, stderr: "" }
        return { stdout: "", stderr: "" }
      },
    })

    expect(invocations.map((invocation) => invocation.command)).toEqual([
      [path.join(root, "bin", "git"), "--version"],
      [path.join(root, "bin", "git"), "--exec-path"],
      [path.join(root, "bin", "git"), "init", "--quiet", "--initial-branch=main", repository],
      [path.join(root, "bin", "git"), "-C", repository, "config", "--local", "user.name", "Guai Code Smoke"],
      [
        path.join(root, "bin", "git"),
        "-C",
        repository,
        "config",
        "--local",
        "user.email",
        "guai-code-smoke@example.invalid",
      ],
      [path.join(root, "bin", "git"), "-C", repository, "add", "packaged-git-smoke.txt"],
      [path.join(root, "bin", "git"), "-C", repository, "commit", "--quiet", "-m", "test: packaged Git relocation"],
      [path.join(root, "bin", "git"), "-C", repository, "rev-parse", "--verify", "HEAD"],
      [path.join(root, "bin", "git"), "-C", repository, "worktree", "add", "--quiet", "--detach", worktree, "HEAD"],
      [path.join(root, "bin", "git"), "-C", worktree, "rev-parse", "--show-toplevel"],
      [path.join(root, "bin", "git"), "-C", worktree, "rev-parse", "--verify", "HEAD"],
      [path.join(root, "bin", "git"), "-C", worktree, "status", "--porcelain=v1"],
    ])
    expect(invocations.every((invocation) => invocation.options.cwd === smoke)).toBeTrue()
    expect(
      invocations.every(
        (invocation) =>
          JSON.stringify(invocation.options.env) ===
          JSON.stringify({
            PATH: path.join(root, "bin"),
            HOME: path.join(smoke, "home"),
            TMPDIR: path.join(smoke, "tmp"),
            XDG_CONFIG_HOME: path.join(smoke, "xdg", "config"),
            XDG_CACHE_HOME: path.join(smoke, "xdg", "cache"),
            XDG_DATA_HOME: path.join(smoke, "xdg", "data"),
            XDG_STATE_HOME: path.join(smoke, "xdg", "state"),
            CFFIXED_USER_HOME: path.join(smoke, "home"),
            DARWIN_USER_CACHE_DIR: path.join(smoke, "mac", "cache"),
            DARWIN_USER_TEMP_DIR: path.join(smoke, "tmp"),
            GIT_EXEC_PATH: path.join(root, "libexec", "git-core"),
            GIT_CONFIG_SYSTEM: path.join(root, "etc", "gitconfig"),
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TEMPLATE_DIR: path.join(root, "share", "git-core", "templates"),
            GIT_TERMINAL_PROMPT: "0",
            LANG: "C",
            LC_ALL: "C",
          }),
      ),
    ).toBeTrue()
    expect(await Bun.file(smoke).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("reports the failing bundled Git stage and cleans its repository", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-git-failure-"))
    const app = path.join(directory, "Guai Code Beta.app")
    const root = path.join(app, "Contents", "Resources", "mingit")
    const smoke = path.join(directory, "git-smoke")
    await Promise.all([
      Bun.write(path.join(root, "bin", "git"), "git"),
      Bun.write(path.join(root, "libexec", "git-core", "git"), "git-core"),
      Bun.write(path.join(root, "etc", "gitconfig"), "config"),
      mkdir(path.join(root, "share", "git-core", "templates"), { recursive: true }),
      Bun.write(path.join(root, "COPYING"), "GPLv2"),
    ])

    await expect(
      verifyInternalMacBundledGit(app, {
        temporaryDirectory: smoke,
        run: async (command) => {
          if (command.includes("--exec-path")) {
            return { stdout: path.join(root, "libexec", "git-core"), stderr: "" }
          }
          if (command.includes("commit")) throw new Error("exit 17: helper unavailable")
          return { stdout: "", stderr: "" }
        },
      }),
    ).rejects.toThrow("commit packaged Git smoke repository: exit 17: helper unavailable")
    expect(await Bun.file(smoke).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("creates an isolated packaged app environment without host toolchain fallback", () => {
    const smoke = "/private/tmp/guai-code-smoke"

    expect(createInternalMacSmokeEnvironment(smoke)).toEqual({
      PATH: path.join(smoke, "bin"),
      HOME: path.join(smoke, "home"),
      TMPDIR: path.join(smoke, "tmp"),
      XDG_CONFIG_HOME: path.join(smoke, "xdg", "config"),
      XDG_CACHE_HOME: path.join(smoke, "xdg", "cache"),
      XDG_DATA_HOME: path.join(smoke, "xdg", "data"),
      XDG_STATE_HOME: path.join(smoke, "xdg", "state"),
      CFFIXED_USER_HOME: path.join(smoke, "home"),
      DARWIN_USER_CACHE_DIR: path.join(smoke, "mac", "cache"),
      DARWIN_USER_TEMP_DIR: path.join(smoke, "tmp"),
      USER: "guai-code-smoke",
      LOGNAME: "guai-code-smoke",
      SHELL: "/usr/bin/false",
      LANG: "C",
      LC_ALL: "C",
      GIT_TRACE2_EVENT: path.join(smoke, "git-trace.json"),
      OPENCODE_UPDATER_ENABLED: "false",
      OPENCODE_SIDECAR_V2: "0",
    })
    expect(createInternalMacSmokeEnvironment(smoke).PATH).not.toContain("/usr/bin")
    expect(createInternalMacSmokeEnvironment(smoke)).not.toHaveProperty("BUN_INSTALL")
    expect(createInternalMacSmokeEnvironment(smoke)).not.toHaveProperty("GIT_CONFIG_GLOBAL")
  })

  test("requires bundled Git injection before the packaged sidecar becomes ready", () => {
    const bundledGit = "/private/zip/Guai Code Beta.app/Contents/Resources/mingit/bin"
    const evidence = [
      "app starting",
      `bundled git enabled { directory: '${bundledGit}' }`,
      "spawning supervised sidecar { url: 'http://127.0.0.1:43123' }",
      "loading task finished",
    ].join("\n")

    expect(() => assertInternalMacSmokeEvidence(evidence, bundledGit)).not.toThrow()
    expect(() =>
      assertInternalMacSmokeEvidence(
        evidence.replace(`bundled git enabled { directory: '${bundledGit}' }\n`, ""),
        bundledGit,
      ),
    ).toThrow("did not enable the bundled Git directory")
    expect(() =>
      assertInternalMacSmokeEvidence(
        [
          "spawning supervised sidecar { url: 'http://127.0.0.1:43123' }",
          `bundled git enabled { directory: '${bundledGit}' }`,
          "loading task finished",
        ].join("\n"),
        bundledGit,
      ),
    ).toThrow("before sidecar startup")
  })

  test("requires structured sidecar trace to name the final ZIP bundled Git executable", () => {
    const executable = "/private/final/Guai Code Beta.app/Contents/Resources/mingit/bin/git"
    expect(() =>
      assertInternalMacSidecarGitTrace(
        `${JSON.stringify({ event: "version", exe: MAC_GIT_VERSION })}\n${JSON.stringify({
          event: "start",
          argv: [executable, "rev-parse", "--git-dir"],
        })}\n`,
        executable,
      ),
    ).not.toThrow()
    expect(() =>
      assertInternalMacSidecarGitTrace(
        `${JSON.stringify({ event: "start", argv: ["/usr/bin/git", "rev-parse"] })}\n`,
        executable,
      ),
    ).toThrow("Traced executable: /usr/bin/git")
  })

  test("launches the packaged app with only isolated HOME, XDG, macOS, and PATH state", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-app-smoke-test-"))
    const app = path.join(directory, "Guai Code Beta.app")
    const executable = path.join(app, "Contents", "MacOS", "Guai Code Beta")
    const smoke = path.join(directory, "smoke")
    await Bun.write(executable, "app")
    let killed = ""
    const bundledGitRoot = path.join(app, "Contents", "Resources", "mingit")
    let spawned:
      | {
          command: readonly string[]
          options: { env: Record<string, string>; stdout: "pipe"; stderr: "pipe" }
        }
      | undefined

    await verifyInternalMacPackagedApp(app, {
      temporaryDirectory: smoke,
      spawn: (command, options) => {
        spawned = { command, options }
        return {
          pid: 12345,
          exitCode: null,
          exited: Promise.resolve(0),
          kill: (signal) => {
            killed = String(signal)
          },
        }
      },
      waitForReady: async (root) => {
        expect((await stat(path.join(root, "home"))).isDirectory()).toBeTrue()
        expect((await stat(path.join(root, "xdg", "config"))).isDirectory()).toBeTrue()
        expect((await stat(path.join(root, "mac", "cache"))).isDirectory()).toBeTrue()
        await Bun.write(
          path.join(root, "git-trace.json"),
          `${JSON.stringify({
            event: "start",
            argv: [path.join(bundledGitRoot, "bin", "git"), "rev-parse", "--git-dir"],
          })}\n`,
        )
        return [
          `bundled git enabled { directory: '${path.join(bundledGitRoot, "bin")}' }`,
          "spawning supervised sidecar",
          "loading task finished",
        ].join("\n")
      },
    })

    expect(spawned?.command).toEqual([executable, `--user-data-dir=${path.join(smoke, "desktop")}`])
    expect(spawned?.options.env).toEqual(createInternalMacSmokeEnvironment(smoke))
    expect(spawned?.options.env.PATH).toBe(path.join(smoke, "bin"))
    expect(spawned?.options.cwd).toBe(path.join(smoke, "workspace"))
    expect(spawned?.options.env).not.toHaveProperty("SSH_AUTH_SOCK")
    expect(killed).toBe("SIGTERM")
    expect(await Bun.file(smoke).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("reports packaged app startup output and cleans failed smoke state", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-app-smoke-failure-"))
    const app = path.join(directory, "Guai Code Beta.app")
    const executable = path.join(app, "Contents", "MacOS", "Guai Code Beta")
    const smoke = path.join(directory, "smoke")
    await Bun.write(executable, "app")

    await expect(
      verifyInternalMacPackagedApp(app, {
        temporaryDirectory: smoke,
        spawn: () => ({
          pid: 12345,
          exitCode: 23,
          exited: Promise.resolve(23),
          stdout: new Blob(["startup stdout"]).stream(),
          stderr: new Blob(["startup stderr"]).stream(),
          kill: () => undefined,
        }),
        waitForReady: async () => {
          throw new Error("Packaged application exited with code 23 before startup completed")
        },
      }),
    ).rejects.toThrow(
      "Packaged application exited with code 23 before startup completed\nstdout: startup stdout\nstderr: startup stderr",
    )
    expect(await Bun.file(smoke).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("extracts and verifies the app from the final delivery ZIP with cleanup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-final-zip-"))
    const archive = path.join(directory, "Guai-Code-Beta.zip")
    const extraction = path.join(directory, "extracted")
    await Bun.write(archive, "zip")
    const verified: string[] = []

    await verifyInternalMacPackagedZip(archive, {
      temporaryDirectory: extraction,
      run: async (command) => {
        expect(command).toEqual(["/usr/bin/ditto", "-x", "-k", archive, extraction])
        await mkdir(path.join(extraction, "Guai Code Beta.app"), { recursive: true })
      },
      verifyBundledGit: async (app) => {
        verified.push(`git:${app}`)
      },
      verifyPackagedApp: async (app) => {
        verified.push(`app:${app}`)
      },
    })

    const extractedApp = path.join(extraction, "Guai Code Beta.app")
    expect(verified).toEqual([`git:${extractedApp}`, `app:${extractedApp}`])
    expect(await Bun.file(extraction).exists()).toBeFalse()
    await rm(directory, { recursive: true, force: true })
  })

  test("cleans a failed final ZIP extraction and wires package smoke to the published ZIP", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-final-zip-failure-"))
    const archive = path.join(directory, "Guai-Code-Beta.zip")
    const extraction = path.join(directory, "extracted")
    await Bun.write(archive, "zip")

    await expect(
      verifyInternalMacPackagedZip(archive, {
        temporaryDirectory: extraction,
        run: async () => {
          throw new Error("invalid central directory")
        },
      }),
    ).rejects.toThrow("Final ZIP extraction failed: invalid central directory")
    expect(await Bun.file(extraction).exists()).toBeFalse()

    const source = await Bun.file(path.join(import.meta.dir, "package-internal-mac.ts")).text()
    expect(source).toContain("await verifyInternalMacPackagedZip(plan.zip)")
    expect(source).not.toContain("verifyInternalMacPackagedApp(plan.app)")
    await rm(directory, { recursive: true, force: true })
  })

  test("requires the checksum manifest to cover every delivery file with actual hashes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "internal-mac-package-"))
    const plan = createInternalMacArtifactPlan(path.join(directory, "desktop"), pkg.version, "arm64")
    const files = getInternalMacDeliveryFiles(plan)
    await Promise.all(files.map((file, index) => Bun.write(file, `delivery-${index}`)))
    const module = await import("./internal-package")
    await Bun.write(
      plan.checksums,
      formatChecksumManifest(
        await Promise.all(files.map(async (file) => ({ file, sha256: await module.sha256(file) }))),
      ),
    )

    await expect(verifyInternalMacChecksumManifest(plan.checksums, files)).resolves.toBeUndefined()
    await Bun.write(plan.zip, "tampered")
    await expect(verifyInternalMacChecksumManifest(plan.checksums, files)).rejects.toThrow("Checksum mismatch")
    await Bun.write(
      plan.checksums,
      formatChecksumManifest(
        await Promise.all(files.slice(1).map(async (file) => ({ file, sha256: await module.sha256(file) }))),
      ),
    )
    await expect(verifyInternalMacChecksumManifest(plan.checksums, files)).rejects.toThrow("do not match")

    await rm(directory, { recursive: true, force: true })
  })

  test("re-exports shared internal package utilities", async () => {
    const module = await import("./package-internal-mac")

    expect(module.formatChecksumManifest).toBe(formatChecksumManifest)
    expect(module.sha256).toBeFunction()
  })
})

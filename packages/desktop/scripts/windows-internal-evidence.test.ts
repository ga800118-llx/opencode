import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { projectEvidenceFile, writeUploadableEvidence } from "./windows-internal-evidence"

const version = "0.1.0-alpha.2"
const coreVersion = "0.1.0"
const windowsVersion = "0.1.0.0"
const installerName = `Guai-Code-Beta-${version}-win-x64.exe`
const portableName = `Guai-Code-Beta-${version}-win-x64-portable.zip`
const guideName = "Guai-Code-Beta-Windows-\u8bd5\u7528\u8bf4\u660e.md"
const gitVersion = "git version 2.55.0.windows.3"
const sha = {
  installer: "1".repeat(64),
  portable: "2".repeat(64),
  guide: "3".repeat(64),
  openCode: "4".repeat(64),
  minGit: "5".repeat(64),
  plaintext: "6".repeat(64),
  ciphertext: "7".repeat(64),
}

const workflowContext = () => ({
  schemaVersion: 1,
  sourceCommit: "a".repeat(40),
  runId: "31359394691",
  runAttempt: "1",
  runnerImage: "win25",
})

const safeStorageEvidence = () => ({
  schemaVersion: 1,
  success: true,
  platform: "win32",
  electronVersion: "42.3.3",
  encryptionAvailable: true,
  nativeProtection: "Windows DPAPI via Electron safeStorage",
  independentProcesses: true,
  sameUser: true,
  encryptProcessId: 100,
  decryptProcessId: 101,
  plaintextSha256: sha.plaintext,
  ciphertextSha256: sha.ciphertext,
  ciphertextBytes: 96,
  plaintextPersisted: false,
  ciphertextDeleted: true,
  localStateExists: true,
  localStateValid: true,
  encryptedKeyPresent: true,
  actualPathsMatched: true,
})

const executable = () => ({
  fileVersion: version,
  productVersion: windowsVersion,
  productName: "Guai Code Beta",
  expectedFileVersion: version,
  expectedProductVersionForms: [coreVersion, windowsVersion],
})

const pe = () => ({
  signature: "0x00004550",
  peHeaderOffset: 256,
  machine: "0x8664",
  architecture: "x64",
})

const packageLicenses = () => ({
  openCode: {
    relativePath: "resources/licenses/OpenCode-MIT.txt",
    sha256: sha.openCode,
    deliveryName: "OpenCode-MIT-License.txt",
    deliverySha256: sha.openCode,
  },
  minGit: {
    relativePath: "resources/mingit/LICENSE.txt",
    sha256: sha.minGit,
    deliveryName: "Git-for-Windows-License.txt",
    deliverySha256: sha.minGit,
  },
})

const launch = (name: "first-launch" | "restart", pid: number, second: number) => ({
  name,
  pid,
  startedAtUtc: `2026-08-10T06:00:0${second}.0000000Z`,
  readyAtUtc: `2026-08-10T06:00:0${second + 1}.0000000Z`,
  readyMilliseconds: 900,
  processAliveAtReady: true,
  bundledGitEnabled: true,
  serverReady: true,
  readinessLogCopiedForScan: true,
  stop: {
    method: "Stop-Process",
    exitCode: 1,
    elapsedMilliseconds: 150,
  },
})

const verifierEvidence = () => ({
  schemaVersion: 2,
  success: true,
  version,
  startedAtUtc: "2026-08-10T06:00:00.0000000Z",
  completedAtUtc: "2026-08-10T06:01:00.0000000Z",
  runner: {
    osVersion: "Microsoft Windows NT 10.0.26100.0",
    is64BitOperatingSystem: true,
    processArchitecture: "AMD64",
    powershellVersion: "7.5.2",
    powershellEdition: "Core",
    runnerOS: "Windows",
    imageOS: "win25",
    imageVersion: "20260803.1.0",
    githubRunId: "31359394691",
    githubSha: "a".repeat(40),
  },
  delivery: {
    files: [
      { name: installerName, sha256: sha.installer, sizeBytes: 1000 },
      { name: portableName, sha256: sha.portable, sizeBytes: 2000 },
      { name: guideName, sha256: sha.guide, sizeBytes: 3000 },
      { name: "OpenCode-MIT-License.txt", sha256: sha.openCode, sizeBytes: 4000 },
      { name: "Git-for-Windows-License.txt", sha256: sha.minGit, sizeBytes: 5000 },
    ],
    licenses: {
      openCode: { name: "OpenCode-MIT-License.txt", sha256: sha.openCode },
      minGit: { name: "Git-for-Windows-License.txt", sha256: sha.minGit },
    },
  },
  installer: {
    name: installerName,
    sha256: sha.installer,
    sizeBytes: 1000,
    authenticodeStatus: "NotSigned",
    ...executable(),
    pe: pe(),
    licenses: packageLicenses(),
    silentInstallRequested: true,
    customInstallDirectoryRequested: true,
    installExitCode: 0,
  },
  portableZip: {
    name: portableName,
    sha256: sha.portable,
    sizeBytes: 2000,
    requiredEntries: [
      "Guai Code Beta.exe",
      "resources/mingit/cmd/git.exe",
      "resources/mingit/LICENSE.txt",
      "resources/licenses/OpenCode-MIT.txt",
    ],
    executable: executable(),
    pe: pe(),
    licenses: packageLicenses(),
    gitVersion,
  },
  gitVersion,
  launches: [launch("first-launch", 200, 1), launch("restart", 201, 3)],
  modelState: {
    exists: false,
    statePresent: false,
    profilesPresent: false,
    profileCount: 0,
  },
  uninstall: {
    attempted: true,
    reasonCode: null,
    executable: "Uninstall Guai Code Beta.exe",
    silent: true,
    exitCode: 0,
    elapsedMilliseconds: 400,
    installDirectoryRemoved: true,
    failureCode: null,
    errorName: null,
  },
  diagnostics: {
    failureCode: null,
    errorName: null,
    cleanupFailureCodes: [],
    copiedLogCount: 2,
  },
})

describe("Windows internal evidence projection", () => {
  test("projects each exact successful evidence schema", () => {
    expect(projectEvidenceFile("workflow-context.json", workflowContext())).toEqual(workflowContext())
    expect(projectEvidenceFile("safe-storage-dpapi.json", safeStorageEvidence())).toEqual(safeStorageEvidence())
    expect(projectEvidenceFile("internal-windows-smoke-evidence.json", verifierEvidence())).toEqual(verifierEvidence())
  })

  test("rejects sensitive extra fields even when their values are innocuous", () => {
    for (const [name, createEvidence] of [
      ["workflow-context.json", workflowContext],
      ["safe-storage-dpapi.json", safeStorageEvidence],
      ["internal-windows-smoke-evidence.json", verifierEvidence],
    ] as const) {
      for (const field of ["plaintext", "ciphertext", "encryptedKey", "keyData", "secret"]) {
        const evidence: Record<string, unknown> = createEvidence()
        evidence[field] = "harmless"
        expect(() => projectEvidenceFile(name, evidence)).toThrow("unknown field")
      }
    }

    const evidence = verifierEvidence()
    const nestedObjects = [
      evidence.runner,
      evidence.delivery,
      evidence.delivery.files[0],
      evidence.delivery.licenses,
      evidence.delivery.licenses.openCode,
      evidence.installer,
      evidence.installer.pe,
      evidence.installer.licenses,
      evidence.installer.licenses.openCode,
      evidence.portableZip,
      evidence.portableZip.executable,
      evidence.portableZip.pe,
      evidence.portableZip.licenses,
      evidence.portableZip.licenses.minGit,
      evidence.launches[0],
      evidence.launches[0].stop,
      evidence.modelState,
      evidence.uninstall,
      evidence.diagnostics,
    ]
    for (const object of nestedObjects) {
      const nested = object as Record<string, unknown>
      nested.secret = "harmless"
      expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", evidence)).toThrow("unknown field")
      delete nested.secret
    }
  })

  test("rejects missing acceptance proof at top-level and nested object levels", () => {
    const missingSourceCommit: Record<string, unknown> = workflowContext()
    delete missingSourceCommit.sourceCommit
    expect(() => projectEvidenceFile("workflow-context.json", missingSourceCommit)).toThrow("missing field")

    const cases = [
      (evidence: Record<string, unknown>) => delete evidence.independentProcesses,
      (evidence: Record<string, unknown>) => delete evidence.actualPathsMatched,
      (evidence: Record<string, unknown>) => delete evidence.encryptedKeyPresent,
    ]
    for (const mutate of cases) {
      const evidence: Record<string, unknown> = safeStorageEvidence()
      mutate(evidence)
      expect(() => projectEvidenceFile("safe-storage-dpapi.json", evidence)).toThrow("missing field")
    }

    const missingInstallerHash = verifierEvidence()
    delete (missingInstallerHash.installer as Partial<typeof missingInstallerHash.installer>).sha256
    expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", missingInstallerHash)).toThrow(
      "missing field",
    )

    const missingRestartMarker = verifierEvidence()
    delete (missingRestartMarker.launches[1] as Partial<(typeof missingRestartMarker.launches)[number]>).serverReady
    expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", missingRestartMarker)).toThrow(
      "missing field",
    )

    const missingUninstallProof = verifierEvidence()
    delete (missingUninstallProof.uninstall as Partial<typeof missingUninstallProof.uninstall>).installDirectoryRemoved
    expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", missingUninstallProof)).toThrow(
      "missing field",
    )

    for (const [target, field] of [
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.runner, "githubSha"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.delivery.files[1], "sizeBytes"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.portableZip, "sha256"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.portableZip.executable, "fileVersion"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence, "gitVersion"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.launches[0], "serverReady"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.launches[0].stop, "method"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.modelState, "profileCount"],
      [(evidence: ReturnType<typeof verifierEvidence>) => evidence.diagnostics, "cleanupFailureCodes"],
    ] as const) {
      const evidence = verifierEvidence()
      delete (target(evidence) as Record<string, unknown>)[field]
      expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", evidence)).toThrow("missing field")
    }
  })

  test("rejects invalid types and constrained acceptance values", () => {
    const unsafeStorage = safeStorageEvidence()
    unsafeStorage.sameUser = false
    expect(() => projectEvidenceFile("safe-storage-dpapi.json", unsafeStorage)).toThrow("sameUser")

    const profiled = verifierEvidence()
    profiled.modelState.profileCount = 1
    expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", profiled)).toThrow("profileCount")

    const incompleteRestart = verifierEvidence()
    incompleteRestart.launches[1].serverReady = false
    expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", incompleteRestart)).toThrow("serverReady")

    const dirtyCleanup = verifierEvidence()
    dirtyCleanup.diagnostics.cleanupFailureCodes.push("TEMPORARY_DIRECTORY_CLEANUP_FAILED")
    expect(() => projectEvidenceFile("internal-windows-smoke-evidence.json", dirtyCleanup)).toThrow(
      "cleanupFailureCodes",
    )
  })

  test("writes only newly projected JSON and excludes scan-only logs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "windows-internal-evidence-"))
    const source = path.join(root, "source")
    const upload = path.join(root, "upload")
    try {
      await mkdir(source)
      await Promise.all([
        Bun.write(path.join(source, "workflow-context.json"), JSON.stringify(workflowContext())),
        Bun.write(path.join(source, "safe-storage-dpapi.json"), JSON.stringify(safeStorageEvidence())),
        Bun.write(path.join(source, "internal-windows-smoke-evidence.json"), JSON.stringify(verifierEvidence())),
        Bun.write(path.join(source, "first-launch-main.log"), "scan-only log"),
      ])

      await writeUploadableEvidence(source, upload)

      expect((await readdir(upload)).sort()).toEqual([
        "internal-windows-smoke-evidence.json",
        "safe-storage-dpapi.json",
        "workflow-context.json",
      ])
      expect(await Bun.file(path.join(upload, "workflow-context.json")).json()).toEqual(workflowContext())
      expect(await Bun.file(path.join(upload, "safe-storage-dpapi.json")).json()).toEqual(safeStorageEvidence())
      expect(await Bun.file(path.join(upload, "internal-windows-smoke-evidence.json")).json()).toEqual(
        verifierEvidence(),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

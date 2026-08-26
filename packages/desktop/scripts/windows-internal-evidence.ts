import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"

const evidenceFiles = [
  "workflow-context.json",
  "safe-storage-dpapi.json",
  "internal-windows-smoke-evidence.json",
] as const
const gitVersion = "git version 2.55.0.windows.3"
const electronVersion = "42.3.3"
const productName = "Guai Code Beta"

type JsonObject = Record<string, unknown>

export function projectEvidenceFile(name: string, value: unknown) {
  if (name === "workflow-context.json") return projectWorkflowContext(value)
  if (name === "safe-storage-dpapi.json") return projectSafeStorageEvidence(value)
  if (name === "internal-windows-smoke-evidence.json") return projectVerifierEvidence(value)
  throw new Error("evidence file: unknown filename")
}

export async function writeUploadableEvidence(sourceDirectory: string, uploadDirectory: string) {
  const [workflow, safeStorage, verifier] = await Promise.all([
    Bun.file(path.join(sourceDirectory, evidenceFiles[0])).json().then(projectWorkflowContext),
    Bun.file(path.join(sourceDirectory, evidenceFiles[1])).json().then(projectSafeStorageEvidence),
    Bun.file(path.join(sourceDirectory, evidenceFiles[2])).json().then(projectVerifierEvidence),
  ])
  const projected = [workflow, safeStorage, verifier]

  if (workflow.sourceCommit !== verifier.runner.githubSha) fail("evidence: source commit mismatch")
  if (workflow.runId !== verifier.runner.githubRunId) fail("evidence: run ID mismatch")
  if (workflow.runnerImage !== verifier.runner.imageOS) fail("evidence: runner image mismatch")
  if (safeStorage.electronVersion !== electronVersion) fail("evidence: Electron version mismatch")

  await rm(uploadDirectory, { recursive: true, force: true })
  await mkdir(uploadDirectory, { recursive: true })
  await Promise.all(
    evidenceFiles.map((name, index) =>
      Bun.write(path.join(uploadDirectory, name), `${JSON.stringify(projected[index], null, 2)}\n`),
    ),
  )

  const uploadedNames = (await readdir(uploadDirectory)).sort()
  const expectedNames = [...evidenceFiles].sort()
  if (uploadedNames.length !== expectedNames.length) fail("upload directory: unexpected file count")
  if (uploadedNames.some((name, index) => name !== expectedNames[index])) {
    fail("upload directory: unexpected filename")
  }
}

function projectWorkflowContext(value: unknown) {
  const input = exactObject(
    value,
    ["schemaVersion", "sourceCommit", "runId", "runAttempt", "runnerImage"],
    "workflow context",
  )
  return {
    schemaVersion: exactNumber(input.schemaVersion, 1, "workflow context.schemaVersion"),
    sourceCommit: sha1(input.sourceCommit, "workflow context.sourceCommit"),
    runId: decimalString(input.runId, "workflow context.runId"),
    runAttempt: decimalString(input.runAttempt, "workflow context.runAttempt"),
    runnerImage: runnerToken(input.runnerImage, "workflow context.runnerImage"),
  }
}

function projectSafeStorageEvidence(value: unknown) {
  const input = exactObject(
    value,
    [
      "schemaVersion",
      "success",
      "platform",
      "electronVersion",
      "encryptionAvailable",
      "nativeProtection",
      "independentProcesses",
      "sameUser",
      "encryptProcessId",
      "decryptProcessId",
      "plaintextSha256",
      "ciphertextSha256",
      "ciphertextBytes",
      "plaintextPersisted",
      "ciphertextDeleted",
      "localStateExists",
      "localStateValid",
      "encryptedKeyPresent",
      "actualPathsMatched",
    ],
    "safeStorage evidence",
  )
  const encryptProcessId = positiveInteger(input.encryptProcessId, "safeStorage evidence.encryptProcessId")
  const decryptProcessId = positiveInteger(input.decryptProcessId, "safeStorage evidence.decryptProcessId")
  if (encryptProcessId === decryptProcessId) fail("safeStorage evidence.independentProcesses: duplicate PIDs")

  return {
    schemaVersion: exactNumber(input.schemaVersion, 1, "safeStorage evidence.schemaVersion"),
    success: exactBoolean(input.success, true, "safeStorage evidence.success"),
    platform: exactString(input.platform, "win32", "safeStorage evidence.platform"),
    electronVersion: exactString(input.electronVersion, electronVersion, "safeStorage evidence.electronVersion"),
    encryptionAvailable: exactBoolean(input.encryptionAvailable, true, "safeStorage evidence.encryptionAvailable"),
    nativeProtection: exactString(
      input.nativeProtection,
      "Windows DPAPI via Electron safeStorage",
      "safeStorage evidence.nativeProtection",
    ),
    independentProcesses: exactBoolean(input.independentProcesses, true, "safeStorage evidence.independentProcesses"),
    sameUser: exactBoolean(input.sameUser, true, "safeStorage evidence.sameUser"),
    encryptProcessId,
    decryptProcessId,
    plaintextSha256: sha256(input.plaintextSha256, "safeStorage evidence.plaintextSha256"),
    ciphertextSha256: sha256(input.ciphertextSha256, "safeStorage evidence.ciphertextSha256"),
    ciphertextBytes: positiveInteger(input.ciphertextBytes, "safeStorage evidence.ciphertextBytes"),
    plaintextPersisted: exactBoolean(input.plaintextPersisted, false, "safeStorage evidence.plaintextPersisted"),
    ciphertextDeleted: exactBoolean(input.ciphertextDeleted, true, "safeStorage evidence.ciphertextDeleted"),
    localStateExists: exactBoolean(input.localStateExists, true, "safeStorage evidence.localStateExists"),
    localStateValid: exactBoolean(input.localStateValid, true, "safeStorage evidence.localStateValid"),
    encryptedKeyPresent: exactBoolean(input.encryptedKeyPresent, true, "safeStorage evidence.encryptedKeyPresent"),
    actualPathsMatched: exactBoolean(input.actualPathsMatched, true, "safeStorage evidence.actualPathsMatched"),
  }
}

function projectVerifierEvidence(value: unknown) {
  const input = exactObject(
    value,
    [
      "schemaVersion",
      "success",
      "version",
      "startedAtUtc",
      "completedAtUtc",
      "runner",
      "delivery",
      "installer",
      "portableZip",
      "gitVersion",
      "launches",
      "modelState",
      "uninstall",
      "diagnostics",
    ],
    "verifier evidence",
  )
  const version = semanticVersion(input.version, "verifier evidence.version")
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!versionMatch) fail("verifier evidence.version: invalid semantic version")
  const coreVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`
  const windowsVersion = `${coreVersion}.0`
  const delivery = projectDelivery(input.delivery, version)
  const installer = projectInstaller(input.installer, version, coreVersion, windowsVersion, delivery)
  const portableZip = projectPortableZip(input.portableZip, version, coreVersion, windowsVersion, delivery)
  const launches = projectLaunches(input.launches)

  if (portableZip.gitVersion !== input.gitVersion) fail("verifier evidence.gitVersion: package mismatch")

  return {
    schemaVersion: exactNumber(input.schemaVersion, 2, "verifier evidence.schemaVersion"),
    success: exactBoolean(input.success, true, "verifier evidence.success"),
    version,
    startedAtUtc: timestamp(input.startedAtUtc, "verifier evidence.startedAtUtc"),
    completedAtUtc: timestamp(input.completedAtUtc, "verifier evidence.completedAtUtc"),
    runner: projectRunner(input.runner),
    delivery,
    installer,
    portableZip,
    gitVersion: exactString(input.gitVersion, gitVersion, "verifier evidence.gitVersion"),
    launches,
    modelState: projectModelState(input.modelState),
    uninstall: projectUninstall(input.uninstall),
    diagnostics: projectDiagnostics(input.diagnostics),
  }
}

function projectRunner(value: unknown) {
  const input = exactObject(
    value,
    [
      "osVersion",
      "is64BitOperatingSystem",
      "processArchitecture",
      "powershellVersion",
      "powershellEdition",
      "runnerOS",
      "imageOS",
      "imageVersion",
      "githubRunId",
      "githubSha",
    ],
    "verifier evidence.runner",
  )
  return {
    osVersion: constrainedString(input.osVersion, /^[A-Za-z0-9 ._-]{1,128}$/, "verifier evidence.runner.osVersion"),
    is64BitOperatingSystem: exactBoolean(
      input.is64BitOperatingSystem,
      true,
      "verifier evidence.runner.is64BitOperatingSystem",
    ),
    processArchitecture: exactString(
      input.processArchitecture,
      "AMD64",
      "verifier evidence.runner.processArchitecture",
    ),
    powershellVersion: constrainedString(
      input.powershellVersion,
      /^\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/,
      "verifier evidence.runner.powershellVersion",
    ),
    powershellEdition: oneOf(
      input.powershellEdition,
      ["Core", "Desktop"],
      "verifier evidence.runner.powershellEdition",
    ),
    runnerOS: exactString(input.runnerOS, "Windows", "verifier evidence.runner.runnerOS"),
    imageOS: runnerToken(input.imageOS, "verifier evidence.runner.imageOS"),
    imageVersion: constrainedString(
      input.imageVersion,
      /^[0-9A-Za-z.-]{1,64}$/,
      "verifier evidence.runner.imageVersion",
    ),
    githubRunId: decimalString(input.githubRunId, "verifier evidence.runner.githubRunId"),
    githubSha: sha1(input.githubSha, "verifier evidence.runner.githubSha"),
  }
}

function projectDelivery(value: unknown, version: string) {
  const input = exactObject(value, ["files", "licenses"], "verifier evidence.delivery")
  const expectedNames = [
    `Guai-Code-Beta-${version}-win-x64.exe`,
    `Guai-Code-Beta-${version}-win-x64-portable.zip`,
    "Guai-Code-Beta-Windows-\u8bd5\u7528\u8bf4\u660e.md",
    "OpenCode-MIT-License.txt",
    "Git-for-Windows-License.txt",
  ]
  const files = exactArray(input.files, expectedNames.length, "verifier evidence.delivery.files").map((file, index) =>
    projectDeliveryFile(file, `verifier evidence.delivery.files[${index}]`),
  )
  if (new Set(files.map((file) => file.name)).size !== files.length) {
    fail("verifier evidence.delivery.files: duplicate filename")
  }
  for (const name of expectedNames) {
    if (!files.some((file) => file.name === name)) fail("verifier evidence.delivery.files: missing expected file")
  }

  const licensesInput = exactObject(input.licenses, ["openCode", "minGit"], "verifier evidence.delivery.licenses")
  const openCode = projectDeliveryLicense(
    licensesInput.openCode,
    "OpenCode-MIT-License.txt",
    "verifier evidence.delivery.licenses.openCode",
  )
  const minGit = projectDeliveryLicense(
    licensesInput.minGit,
    "Git-for-Windows-License.txt",
    "verifier evidence.delivery.licenses.minGit",
  )
  assertDeliveryHash(files, openCode.name, openCode.sha256, "verifier evidence.delivery.licenses.openCode")
  assertDeliveryHash(files, minGit.name, minGit.sha256, "verifier evidence.delivery.licenses.minGit")

  return { files, licenses: { openCode, minGit } }
}

function projectDeliveryFile(value: unknown, label: string) {
  const input = exactObject(value, ["name", "sha256", "sizeBytes"], label)
  return {
    name: deliveryFilename(input.name, `${label}.name`),
    sha256: sha256(input.sha256, `${label}.sha256`),
    sizeBytes: positiveInteger(input.sizeBytes, `${label}.sizeBytes`),
  }
}

function projectDeliveryLicense(value: unknown, expectedName: string, label: string) {
  const input = exactObject(value, ["name", "sha256"], label)
  return {
    name: exactString(input.name, expectedName, `${label}.name`),
    sha256: sha256(input.sha256, `${label}.sha256`),
  }
}

function projectInstaller(
  value: unknown,
  version: string,
  coreVersion: string,
  windowsVersion: string,
  delivery: ReturnType<typeof projectDelivery>,
) {
  const label = "verifier evidence.installer"
  const input = exactObject(
    value,
    [
      "name",
      "sha256",
      "sizeBytes",
      "authenticodeStatus",
      "fileVersion",
      "productVersion",
      "productName",
      "expectedFileVersion",
      "expectedProductVersionForms",
      "pe",
      "licenses",
      "silentInstallRequested",
      "customInstallDirectoryRequested",
      "installExitCode",
    ],
    label,
  )
  const name = exactString(input.name, `Guai-Code-Beta-${version}-win-x64.exe`, `${label}.name`)
  const hash = sha256(input.sha256, `${label}.sha256`)
  const sizeBytes = positiveInteger(input.sizeBytes, `${label}.sizeBytes`)
  assertDeliveryFile(delivery.files, name, hash, sizeBytes, label)

  return {
    name,
    sha256: hash,
    sizeBytes,
    authenticodeStatus: oneOf(input.authenticodeStatus, ["NotSigned", "Valid"], `${label}.authenticodeStatus`),
    ...projectExecutableMetadata(input, version, coreVersion, windowsVersion, label),
    pe: projectPe(input.pe, `${label}.pe`),
    licenses: projectPackageLicenses(input.licenses, delivery, `${label}.licenses`),
    silentInstallRequested: exactBoolean(input.silentInstallRequested, true, `${label}.silentInstallRequested`),
    customInstallDirectoryRequested: exactBoolean(
      input.customInstallDirectoryRequested,
      true,
      `${label}.customInstallDirectoryRequested`,
    ),
    installExitCode: exactNumber(input.installExitCode, 0, `${label}.installExitCode`),
  }
}

function projectPortableZip(
  value: unknown,
  version: string,
  coreVersion: string,
  windowsVersion: string,
  delivery: ReturnType<typeof projectDelivery>,
) {
  const label = "verifier evidence.portableZip"
  const input = exactObject(
    value,
    ["name", "sha256", "sizeBytes", "requiredEntries", "executable", "pe", "licenses", "gitVersion"],
    label,
  )
  const name = exactString(input.name, `Guai-Code-Beta-${version}-win-x64-portable.zip`, `${label}.name`)
  const hash = sha256(input.sha256, `${label}.sha256`)
  const sizeBytes = positiveInteger(input.sizeBytes, `${label}.sizeBytes`)
  assertDeliveryFile(delivery.files, name, hash, sizeBytes, label)
  const requiredEntries = exactStringArray(
    input.requiredEntries,
    [
      "Guai Code Beta.exe",
      "resources/mingit/cmd/git.exe",
      "resources/mingit/LICENSE.txt",
      "resources/ripgrep/rg.exe",
      "resources/ripgrep/LICENSE-MIT",
      "resources/licenses/OpenCode-MIT.txt",
    ],
    `${label}.requiredEntries`,
  )
  const executableInput = exactObject(
    input.executable,
    ["fileVersion", "productVersion", "productName", "expectedFileVersion", "expectedProductVersionForms"],
    `${label}.executable`,
  )

  return {
    name,
    sha256: hash,
    sizeBytes,
    requiredEntries,
    executable: projectExecutableMetadata(executableInput, version, coreVersion, windowsVersion, `${label}.executable`),
    pe: projectPe(input.pe, `${label}.pe`),
    licenses: projectPackageLicenses(input.licenses, delivery, `${label}.licenses`),
    gitVersion: exactString(input.gitVersion, gitVersion, `${label}.gitVersion`),
  }
}

function projectExecutableMetadata(
  input: JsonObject,
  version: string,
  coreVersion: string,
  windowsVersion: string,
  label: string,
) {
  const productVersionValue = constrainedString(
    input.productVersion,
    /^\d+(?:[.,]\s*\d+){2,3}$/,
    `${label}.productVersion`,
  )
  const normalizedProductVersion = productVersionValue.replace(/,\s*/g, ".").replace(/\s/g, "")
  if (![coreVersion, windowsVersion].includes(normalizedProductVersion)) {
    fail(`${label}.productVersion: unexpected value`)
  }
  return {
    fileVersion: exactString(input.fileVersion, version, `${label}.fileVersion`),
    productVersion: productVersionValue,
    productName: exactString(input.productName, productName, `${label}.productName`),
    expectedFileVersion: exactString(input.expectedFileVersion, version, `${label}.expectedFileVersion`),
    expectedProductVersionForms: exactStringArray(
      input.expectedProductVersionForms,
      [coreVersion, windowsVersion],
      `${label}.expectedProductVersionForms`,
    ),
  }
}

function projectPe(value: unknown, label: string) {
  const input = exactObject(value, ["signature", "peHeaderOffset", "machine", "architecture"], label)
  return {
    signature: exactString(input.signature, "0x00004550", `${label}.signature`),
    peHeaderOffset: nonNegativeInteger(input.peHeaderOffset, `${label}.peHeaderOffset`),
    machine: exactString(input.machine, "0x8664", `${label}.machine`),
    architecture: exactString(input.architecture, "x64", `${label}.architecture`),
  }
}

function projectPackageLicenses(value: unknown, delivery: ReturnType<typeof projectDelivery>, label: string) {
  const input = exactObject(value, ["openCode", "minGit"], label)
  return {
    openCode: projectPackageLicense(
      input.openCode,
      "resources/licenses/OpenCode-MIT.txt",
      "OpenCode-MIT-License.txt",
      delivery,
      `${label}.openCode`,
    ),
    minGit: projectPackageLicense(
      input.minGit,
      "resources/mingit/LICENSE.txt",
      "Git-for-Windows-License.txt",
      delivery,
      `${label}.minGit`,
    ),
  }
}

function projectPackageLicense(
  value: unknown,
  expectedPath: string,
  expectedDeliveryName: string,
  delivery: ReturnType<typeof projectDelivery>,
  label: string,
) {
  const input = exactObject(value, ["relativePath", "sha256", "deliveryName", "deliverySha256"], label)
  const hash = sha256(input.sha256, `${label}.sha256`)
  const deliveryHash = sha256(input.deliverySha256, `${label}.deliverySha256`)
  if (hash !== deliveryHash) fail(`${label}: license hash mismatch`)
  assertDeliveryHash(delivery.files, expectedDeliveryName, deliveryHash, label)
  return {
    relativePath: exactString(input.relativePath, expectedPath, `${label}.relativePath`),
    sha256: hash,
    deliveryName: exactString(input.deliveryName, expectedDeliveryName, `${label}.deliveryName`),
    deliverySha256: deliveryHash,
  }
}

function projectLaunches(value: unknown) {
  const launches = exactArray(value, 2, "verifier evidence.launches").map((launch, index) =>
    projectLaunch(launch, index === 0 ? "first-launch" : "restart", `verifier evidence.launches[${index}]`),
  )
  if (launches[0].pid === launches[1].pid) fail("verifier evidence.launches: duplicate PIDs")
  return launches
}

function projectLaunch(value: unknown, expectedName: string, label: string) {
  const input = exactObject(
    value,
    [
      "name",
      "pid",
      "startedAtUtc",
      "readyAtUtc",
      "readyMilliseconds",
      "processAliveAtReady",
      "bundledGitEnabled",
      "serverReady",
      "readinessLogCopiedForScan",
      "stop",
    ],
    label,
  )
  const stopInput = exactObject(input.stop, ["method", "exitCode", "elapsedMilliseconds"], `${label}.stop`)
  return {
    name: exactString(input.name, expectedName, `${label}.name`),
    pid: positiveInteger(input.pid, `${label}.pid`),
    startedAtUtc: timestamp(input.startedAtUtc, `${label}.startedAtUtc`),
    readyAtUtc: timestamp(input.readyAtUtc, `${label}.readyAtUtc`),
    readyMilliseconds: nonNegativeInteger(input.readyMilliseconds, `${label}.readyMilliseconds`),
    processAliveAtReady: exactBoolean(input.processAliveAtReady, true, `${label}.processAliveAtReady`),
    bundledGitEnabled: exactBoolean(input.bundledGitEnabled, true, `${label}.bundledGitEnabled`),
    serverReady: exactBoolean(input.serverReady, true, `${label}.serverReady`),
    readinessLogCopiedForScan: exactBoolean(
      input.readinessLogCopiedForScan,
      true,
      `${label}.readinessLogCopiedForScan`,
    ),
    stop: {
      method: exactString(stopInput.method, "Stop-Process", `${label}.stop.method`),
      exitCode: integer(stopInput.exitCode, `${label}.stop.exitCode`),
      elapsedMilliseconds: nonNegativeInteger(stopInput.elapsedMilliseconds, `${label}.stop.elapsedMilliseconds`),
    },
  }
}

function projectModelState(value: unknown) {
  const label = "verifier evidence.modelState"
  const input = exactObject(value, ["exists", "statePresent", "profilesPresent", "profileCount"], label)
  const exists = boolean(input.exists, `${label}.exists`)
  const statePresent = boolean(input.statePresent, `${label}.statePresent`)
  const profilesPresent = boolean(input.profilesPresent, `${label}.profilesPresent`)
  if (!exists && (statePresent || profilesPresent)) fail(`${label}: absent store cannot contain state or profiles`)
  return {
    exists,
    statePresent,
    profilesPresent,
    profileCount: exactNumber(input.profileCount, 0, `${label}.profileCount`),
  }
}

function projectUninstall(value: unknown) {
  const label = "verifier evidence.uninstall"
  const input = exactObject(
    value,
    [
      "attempted",
      "reasonCode",
      "executable",
      "silent",
      "exitCode",
      "elapsedMilliseconds",
      "installDirectoryRemoved",
      "failureCode",
      "errorName",
    ],
    label,
  )
  return {
    attempted: exactBoolean(input.attempted, true, `${label}.attempted`),
    reasonCode: exactNull(input.reasonCode, `${label}.reasonCode`),
    executable: exactString(input.executable, "Uninstall Guai Code Beta.exe", `${label}.executable`),
    silent: exactBoolean(input.silent, true, `${label}.silent`),
    exitCode: exactNumber(input.exitCode, 0, `${label}.exitCode`),
    elapsedMilliseconds: nonNegativeInteger(input.elapsedMilliseconds, `${label}.elapsedMilliseconds`),
    installDirectoryRemoved: exactBoolean(input.installDirectoryRemoved, true, `${label}.installDirectoryRemoved`),
    failureCode: exactNull(input.failureCode, `${label}.failureCode`),
    errorName: exactNull(input.errorName, `${label}.errorName`),
  }
}

function projectDiagnostics(value: unknown) {
  const label = "verifier evidence.diagnostics"
  const input = exactObject(value, ["failureCode", "errorName", "cleanupFailureCodes", "copiedLogCount"], label)
  const cleanupFailureCodes = exactArray(input.cleanupFailureCodes, 0, `${label}.cleanupFailureCodes`)
  return {
    failureCode: exactNull(input.failureCode, `${label}.failureCode`),
    errorName: exactNull(input.errorName, `${label}.errorName`),
    cleanupFailureCodes,
    copiedLogCount: minimumInteger(input.copiedLogCount, 2, `${label}.copiedLogCount`),
  }
}

function exactObject(value: unknown, fields: readonly string[], label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label}: expected object`)
  const input = value as JsonObject
  for (const key of Object.keys(input)) {
    if (!fields.includes(key)) fail(`${label}: unknown field ${key}`)
  }
  for (const field of fields) {
    if (!Object.hasOwn(input, field)) fail(`${label}: missing field ${field}`)
  }
  return input
}

function exactArray(value: unknown, length: number, label: string) {
  if (!Array.isArray(value)) fail(`${label}: expected array`)
  if (value.length !== length) fail(`${label}: expected ${length} items`)
  return value
}

function exactStringArray(value: unknown, expected: readonly string[], label: string) {
  const input = exactArray(value, expected.length, label)
  return input.map((item, index) => exactString(item, expected[index], `${label}[${index}]`))
}

function string(value: unknown, label: string) {
  if (typeof value !== "string") fail(`${label}: expected string`)
  return value
}

function exactString(value: unknown, expected: string, label: string) {
  const input = string(value, label)
  if (input !== expected) fail(`${label}: unexpected value`)
  return input
}

function constrainedString(value: unknown, pattern: RegExp, label: string) {
  const input = string(value, label)
  if (!pattern.test(input)) fail(`${label}: unexpected value`)
  return input
}

function oneOf<const Value extends string>(value: unknown, allowed: readonly Value[], label: string): Value {
  const input = string(value, label)
  if (!allowed.includes(input as Value)) fail(`${label}: unexpected value`)
  return input as Value
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") fail(`${label}: expected boolean`)
  return value
}

function exactBoolean(value: unknown, expected: boolean, label: string) {
  const input = boolean(value, label)
  if (input !== expected) fail(`${label}: unexpected value`)
  return input
}

function integer(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${label}: expected integer`)
  return value
}

function exactNumber(value: unknown, expected: number, label: string) {
  const input = integer(value, label)
  if (input !== expected) fail(`${label}: unexpected value`)
  return input
}

function nonNegativeInteger(value: unknown, label: string) {
  const input = integer(value, label)
  if (input < 0) fail(`${label}: expected non-negative integer`)
  return input
}

function positiveInteger(value: unknown, label: string) {
  return minimumInteger(value, 1, label)
}

function minimumInteger(value: unknown, minimum: number, label: string) {
  const input = integer(value, label)
  if (input < minimum) fail(`${label}: value below minimum`)
  return input
}

function exactNull(value: unknown, label: string) {
  if (value !== null) fail(`${label}: expected null`)
  return null
}

function sha1(value: unknown, label: string) {
  return constrainedString(value, /^[0-9a-f]{40}$/, label)
}

function sha256(value: unknown, label: string) {
  return constrainedString(value, /^[0-9a-f]{64}$/, label)
}

function decimalString(value: unknown, label: string) {
  return constrainedString(value, /^[1-9][0-9]*$/, label)
}

function runnerToken(value: unknown, label: string) {
  return constrainedString(value, /^[0-9A-Za-z._-]{1,64}$/, label)
}

function semanticVersion(value: unknown, label: string) {
  return constrainedString(
    value,
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    label,
  )
}

function timestamp(value: unknown, label: string) {
  return constrainedString(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,7}Z$/, label)
}

function deliveryFilename(value: unknown, label: string) {
  return constrainedString(value, /^[^\\/:*?"<>|\u0000-\u001f]{1,255}$/, label)
}

function assertDeliveryHash(
  files: ReturnType<typeof projectDeliveryFile>[],
  name: string,
  hash: string,
  label: string,
) {
  const file = files.find((candidate) => candidate.name === name)
  if (!file || file.sha256 !== hash) fail(`${label}: delivery hash mismatch`)
}

function assertDeliveryFile(
  files: ReturnType<typeof projectDeliveryFile>[],
  name: string,
  hash: string,
  sizeBytes: number,
  label: string,
) {
  const file = files.find((candidate) => candidate.name === name)
  if (!file || file.sha256 !== hash || file.sizeBytes !== sizeBytes) fail(`${label}: delivery metadata mismatch`)
}

function fail(message: string): never {
  throw new Error(message)
}

if (import.meta.main) {
  const [sourceDirectory, uploadDirectory, ...extra] = Bun.argv.slice(2)
  if (!sourceDirectory || !uploadDirectory || extra.length > 0) {
    process.stderr.write("Windows evidence projection failed.\n")
    process.exitCode = 1
  } else {
    try {
      await writeUploadableEvidence(sourceDirectory, uploadDirectory)
      process.stdout.write("Windows evidence projection passed.\n")
    } catch {
      process.stderr.write("Windows evidence projection failed.\n")
      process.exitCode = 1
    }
  }
}

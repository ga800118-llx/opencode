import path from "node:path"

export const DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS = 65 * 60_000
export const DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS = 15_000

const packagedClientProducer = "guai-code-packaged-qa"
const packagedClientProduct = "Guai Code Beta"
const sessionExportMaximumBytes = 32 * 1024 * 1024
const checksumManifestMaximumBytes = 1024 * 1024
const packageNamePattern = /^Guai-Code-Beta-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-mac-arm64\.(dmg|zip)$/

export type MacRuntimeSoakDisconnectReason =
  | "completed"
  | "client-abort"
  | "client-unresponsive"
  | "response-error"
  | "fixture-stop"
  | "connection-timeout"

export type MacRuntimeSoakObservation = {
  runID: string
  terminalMarker: string
  startedAt: string
  completedAt: string
  requestedDurationMs: number
  observedDurationMs: number
  chunks: number
  activityAt: string[]
  terminalAt: string | null
  maxActivityGapMs: number
  clientAbort: boolean
  completed: boolean
  disconnectReason: MacRuntimeSoakDisconnectReason
}

export type MacRuntimeSoakServerEvidence = Omit<
  MacRuntimeSoakObservation,
  "terminalAt" | "clientAbort" | "completed" | "disconnectReason"
> & {
  terminalAt: string
  clientAbort: false
  completed: true
  disconnectReason: "completed"
}

export type MacRuntimeSoakSessionExport = {
  schemaVersion: 1
  producer: {
    id: "guai-code-packaged-qa"
    product: "Guai Code Beta"
    version: string
    platform: "darwin"
    arch: "arm64"
  }
  package: {
    fileName: string
    sha256: string
  }
  session: {
    runID: string
    completedAt: string
    assistant: {
      role: "assistant"
      output: string
      parts: { type: "text"; text: string }[]
    }
  }
}

export type MacRuntimeSoakPackagedClientAcknowledgment = {
  runID: string
  terminalMarker: string
  source: "packaged-client-session-export"
  sourcePath: string
  sourceSha256: string
  manifestPath: string
  manifestSha256: string
  packagePath: string
  packageSha256: string
  packageVersion: string
  packageFormat: "dmg" | "zip"
  acknowledgedAt: string
}

export type MacRuntimeSoakEvidence = MacRuntimeSoakServerEvidence & {
  packagedClientAcknowledgment: MacRuntimeSoakPackagedClientAcknowledgment
}

export type MacRuntimeSoakEvidencePolicy = {
  minimumRequestedDurationMs?: number
  minimumChunks?: number
  maximumActivityGapMs?: number
  durationToleranceMs?: number
}

const observationKeys = [
  "runID",
  "terminalMarker",
  "startedAt",
  "completedAt",
  "requestedDurationMs",
  "observedDurationMs",
  "chunks",
  "activityAt",
  "terminalAt",
  "maxActivityGapMs",
  "clientAbort",
  "completed",
  "disconnectReason",
]

const acknowledgmentKeys: (keyof MacRuntimeSoakPackagedClientAcknowledgment)[] = [
  "runID",
  "terminalMarker",
  "source",
  "sourcePath",
  "sourceSha256",
  "manifestPath",
  "manifestSha256",
  "packagePath",
  "packageSha256",
  "packageVersion",
  "packageFormat",
  "acknowledgedAt",
]

export function macRuntimeSoakTerminalMarker(runID: string) {
  return `MAC_RUNTIME_SOAK_COMPLETE:${runID}`
}

export function assertMacRuntimeSoakServerEvidence(
  value: unknown,
  policy: MacRuntimeSoakEvidencePolicy = {},
): MacRuntimeSoakServerEvidence {
  const evidence = requireRecord(value, "Soak server evidence")
  requireExactKeys(evidence, observationKeys, "Soak server evidence")
  const minimumRequestedDurationMs = policy.minimumRequestedDurationMs ?? DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS
  const minimumChunks = policy.minimumChunks ?? 2
  const maximumActivityGapMs = policy.maximumActivityGapMs ?? DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS * 2
  const durationToleranceMs = policy.durationToleranceMs ?? 2_000
  requireNonNegativeInteger(minimumRequestedDurationMs, "minimum requested duration")
  requireNonNegativeInteger(minimumChunks, "minimum chunks")
  requirePositiveInteger(maximumActivityGapMs, "maximum activity gap")
  requireNonNegativeInteger(durationToleranceMs, "duration tolerance")

  if (typeof evidence.runID !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(evidence.runID)) {
    throw new Error("Soak server evidence runID is invalid")
  }
  if (evidence.terminalMarker !== macRuntimeSoakTerminalMarker(evidence.runID)) {
    throw new Error("Soak server evidence terminal marker does not match its runID")
  }
  const startedAt = requireTimestamp(evidence.startedAt, "startedAt")
  const completedAt = requireTimestamp(evidence.completedAt, "completedAt")
  requirePositiveInteger(evidence.requestedDurationMs, "requestedDurationMs")
  requireNonNegativeInteger(evidence.observedDurationMs, "observedDurationMs")
  requireNonNegativeInteger(evidence.chunks, "chunks")
  requireNonNegativeInteger(evidence.maxActivityGapMs, "maxActivityGapMs")
  if (!Array.isArray(evidence.activityAt)) throw new Error("Soak server evidence activityAt must be an array")
  if (evidence.activityAt.length !== evidence.chunks) {
    throw new Error("Soak server evidence chunk count does not match activity timestamps")
  }
  const activityAt = evidence.activityAt.map((item, index) => requireTimestamp(item, `activityAt[${index}]`))
  const terminalAt = requireTimestamp(evidence.terminalAt, "terminalAt")

  if (evidence.clientAbort !== false) throw new Error("Soak client aborted the response")
  if (evidence.completed !== true) throw new Error("Soak response did not complete")
  if (evidence.disconnectReason !== "completed") throw new Error("Soak response did not finish normally")
  if (evidence.requestedDurationMs < minimumRequestedDurationMs) {
    throw new Error("Soak evidence requested duration is below the verification minimum")
  }
  if (evidence.observedDurationMs < evidence.requestedDurationMs) {
    throw new Error("Soak evidence ended before the requested duration")
  }
  if (evidence.chunks < minimumChunks) throw new Error("Soak evidence contains too few activity chunks")

  const timeline = [startedAt.millis, ...activityAt.map((item) => item.millis), terminalAt.millis, completedAt.millis]
  if (timeline.some((item, index) => index > 0 && item < timeline[index - 1])) {
    throw new Error("Soak evidence timestamps are out of order")
  }
  if (Math.abs(completedAt.millis - startedAt.millis - evidence.observedDurationMs) > durationToleranceMs) {
    throw new Error("Soak evidence timestamp span does not match observed duration")
  }
  const calculatedMaxGap = Math.max(...timeline.slice(1).map((item, index) => item - timeline[index]))
  if (Math.abs(calculatedMaxGap - evidence.maxActivityGapMs) > 2) {
    throw new Error("Soak evidence maximum activity gap is inconsistent")
  }
  if (evidence.maxActivityGapMs > maximumActivityGapMs) {
    throw new Error("Soak evidence activity gap exceeded the verification maximum")
  }
  return {
    runID: evidence.runID,
    terminalMarker: evidence.terminalMarker,
    startedAt: startedAt.value,
    completedAt: completedAt.value,
    requestedDurationMs: evidence.requestedDurationMs,
    observedDurationMs: evidence.observedDurationMs,
    chunks: evidence.chunks,
    activityAt: activityAt.map((item) => item.value),
    terminalAt: terminalAt.value,
    maxActivityGapMs: evidence.maxActivityGapMs,
    clientAbort: false,
    completed: true,
    disconnectReason: "completed",
  }
}

export async function combineMacRuntimeSoakEvidence(
  server: unknown,
  input: { sourcePath: string; manifestPath: string; packagePath: string },
  policy: MacRuntimeSoakEvidencePolicy = {},
): Promise<MacRuntimeSoakEvidence> {
  const verifiedServer = assertMacRuntimeSoakServerEvidence(server, policy)
  const packagedClientAcknowledgment = await loadPackagedClientAcknowledgment(verifiedServer, input)
  return assertMacRuntimeSoakEvidence({ ...verifiedServer, packagedClientAcknowledgment }, policy)
}

export async function verifyMacRuntimeSoakEvidence(
  value: unknown,
  policy: MacRuntimeSoakEvidencePolicy = {},
): Promise<MacRuntimeSoakEvidence> {
  const evidence = assertMacRuntimeSoakEvidence(value, policy)
  const current = await loadPackagedClientAcknowledgment(evidence, evidence.packagedClientAcknowledgment)
  if (acknowledgmentKeys.some((key) => current[key] !== evidence.packagedClientAcknowledgment[key])) {
    throw new Error("Packaged client evidence no longer matches its source artifacts")
  }
  return evidence
}

export function assertMacRuntimeSoakEvidence(
  value: unknown,
  policy: MacRuntimeSoakEvidencePolicy = {},
): MacRuntimeSoakEvidence {
  const evidence = requireRecord(value, "Soak evidence")
  requireExactKeys(evidence, [...observationKeys, "packagedClientAcknowledgment"], "Soak evidence")
  const server = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "packagedClientAcknowledgment"))
  const verifiedServer = assertMacRuntimeSoakServerEvidence(server, policy)
  const acknowledgment = requireRecord(evidence.packagedClientAcknowledgment, "Packaged client acknowledgment")
  requireExactKeys(acknowledgment, acknowledgmentKeys, "Packaged client acknowledgment")
  if (acknowledgment.runID !== verifiedServer.runID) {
    throw new Error("Packaged client acknowledgment runID does not match the server evidence")
  }
  if (acknowledgment.terminalMarker !== verifiedServer.terminalMarker) {
    throw new Error("Packaged client acknowledgment terminal marker does not match the server evidence")
  }
  if (acknowledgment.source !== "packaged-client-session-export") {
    throw new Error("Packaged client acknowledgment source is invalid")
  }
  requireAbsolutePath(acknowledgment.sourcePath, "source")
  requireSha256(acknowledgment.sourceSha256, "source")
  requireAbsolutePath(acknowledgment.manifestPath, "manifest")
  requireSha256(acknowledgment.manifestSha256, "manifest")
  requireAbsolutePath(acknowledgment.packagePath, "package")
  requireSha256(acknowledgment.packageSha256, "package")
  if (path.basename(acknowledgment.manifestPath) !== "SHA256SUMS.txt") {
    throw new Error("Packaged client checksum manifest path is invalid")
  }
  const packageIdentity = requirePackageIdentity(path.basename(acknowledgment.packagePath))
  if (acknowledgment.packageVersion !== packageIdentity.version) {
    throw new Error("Packaged client package version is inconsistent")
  }
  if (acknowledgment.packageFormat !== packageIdentity.format) {
    throw new Error("Packaged client package format is inconsistent")
  }
  const acknowledgedAt = requireTimestamp(acknowledgment.acknowledgedAt, "acknowledgedAt")
  if (acknowledgedAt.millis < Date.parse(verifiedServer.terminalAt)) {
    throw new Error("Packaged client acknowledgment predates the terminal marker")
  }
  return {
    ...verifiedServer,
    packagedClientAcknowledgment: {
      runID: verifiedServer.runID,
      terminalMarker: verifiedServer.terminalMarker,
      source: "packaged-client-session-export",
      sourcePath: acknowledgment.sourcePath,
      sourceSha256: acknowledgment.sourceSha256,
      manifestPath: acknowledgment.manifestPath,
      manifestSha256: acknowledgment.manifestSha256,
      packagePath: acknowledgment.packagePath,
      packageSha256: acknowledgment.packageSha256,
      packageVersion: packageIdentity.version,
      packageFormat: packageIdentity.format,
      acknowledgedAt: acknowledgedAt.value,
    },
  }
}

async function loadPackagedClientAcknowledgment(
  server: MacRuntimeSoakServerEvidence,
  input: { sourcePath: string; manifestPath: string; packagePath: string },
) {
  const sourcePath = path.resolve(input.sourcePath)
  const manifestPath = path.resolve(input.manifestPath)
  const packagePath = path.resolve(input.packagePath)
  const source = Bun.file(sourcePath)
  const manifest = Bun.file(manifestPath)
  const packageArtifact = Bun.file(packagePath)
  if (!(await source.exists())) throw new Error("Packaged client session export does not exist")
  if (!(await manifest.exists())) throw new Error("Packaged client checksum manifest does not exist")
  if (!(await packageArtifact.exists())) throw new Error("Packaged client package artifact does not exist")
  if (source.size > sessionExportMaximumBytes) throw new Error("Packaged client session export is too large")
  if (manifest.size > checksumManifestMaximumBytes) throw new Error("Packaged client checksum manifest is too large")
  if (path.basename(manifestPath) !== "SHA256SUMS.txt") {
    throw new Error("Packaged client checksum manifest must be named SHA256SUMS.txt")
  }
  if (path.dirname(manifestPath) !== path.dirname(packagePath)) {
    throw new Error("Packaged client checksum manifest must be next to the package artifact")
  }

  const packageIdentity = requirePackageIdentity(path.basename(packagePath))
  const sessionExport = parseSessionExport(await source.text(), server)
  if (sessionExport.producer.version !== packageIdentity.version) {
    throw new Error("Packaged client session export version does not match the package name")
  }
  if (sessionExport.package.fileName !== path.basename(packagePath)) {
    throw new Error("Packaged client session export package name does not match")
  }
  const packageSha256 = await sha256(packagePath)
  if (sessionExport.package.sha256 !== packageSha256) {
    throw new Error("Packaged client session export package hash does not match")
  }

  const manifestEntries = parseChecksumManifest(await manifest.text())
  const manifestEntry = manifestEntries.find((entry) => entry.file === path.basename(packagePath))
  if (!manifestEntry) throw new Error("Packaged client checksum manifest does not list the package")
  if (manifestEntry.sha256 !== packageSha256) {
    throw new Error("Packaged client checksum manifest package hash does not match")
  }
  await validatePackageArtifact(packagePath, packageIdentity.format)

  return {
    runID: server.runID,
    terminalMarker: server.terminalMarker,
    source: "packaged-client-session-export",
    sourcePath,
    sourceSha256: await sha256(sourcePath),
    manifestPath,
    manifestSha256: await sha256(manifestPath),
    packagePath,
    packageSha256,
    packageVersion: packageIdentity.version,
    packageFormat: packageIdentity.format,
    acknowledgedAt: sessionExport.session.completedAt,
  } satisfies MacRuntimeSoakPackagedClientAcknowledgment
}

function parseSessionExport(value: string, server: MacRuntimeSoakServerEvidence): MacRuntimeSoakSessionExport {
  const parsed = parseJson(value, "Packaged client session export")
  const sessionExport = requireRecord(parsed, "Packaged client session export")
  requireExactKeys(sessionExport, ["schemaVersion", "producer", "package", "session"], "Packaged client session export")
  if (sessionExport.schemaVersion !== 1) throw new Error("Packaged client session export schema version is invalid")

  const producer = requireRecord(sessionExport.producer, "Packaged client session export producer")
  requireExactKeys(
    producer,
    ["id", "product", "version", "platform", "arch"],
    "Packaged client session export producer",
  )
  if (producer.id !== packagedClientProducer || producer.product !== packagedClientProduct) {
    throw new Error("Packaged client session export producer is invalid")
  }
  if (typeof producer.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(producer.version)) {
    throw new Error("Packaged client session export product version is invalid")
  }
  if (producer.platform !== "darwin" || producer.arch !== "arm64") {
    throw new Error("Packaged client session export platform is invalid")
  }

  const packageMetadata = requireRecord(sessionExport.package, "Packaged client session export package")
  requireExactKeys(packageMetadata, ["fileName", "sha256"], "Packaged client session export package")
  if (
    typeof packageMetadata.fileName !== "string" ||
    path.basename(packageMetadata.fileName) !== packageMetadata.fileName
  ) {
    throw new Error("Packaged client session export package name is invalid")
  }
  requireSha256(packageMetadata.sha256, "session export package")

  const session = requireRecord(sessionExport.session, "Packaged client session export session")
  requireExactKeys(session, ["runID", "completedAt", "assistant"], "Packaged client session export session")
  if (session.runID !== server.runID) throw new Error("Packaged client session export runID does not match")
  const completedAt = requireTimestamp(session.completedAt, "session export completedAt")
  if (completedAt.millis < Date.parse(server.terminalAt)) {
    throw new Error("Packaged client session export predates the terminal marker")
  }

  const assistant = requireRecord(session.assistant, "Packaged client session export assistant")
  requireExactKeys(assistant, ["role", "output", "parts"], "Packaged client session export assistant")
  if (assistant.role !== "assistant") throw new Error("Packaged client session export assistant role is invalid")
  const output = requireText(assistant.output, "Packaged client session export assistant output", 16 * 1024 * 1024)
  if (!Array.isArray(assistant.parts) || assistant.parts.length === 0 || assistant.parts.length > 4_096) {
    throw new Error("Packaged client session export assistant parts are invalid")
  }
  const parts = assistant.parts.map((value, index) => {
    const part = requireRecord(value, `Packaged client session export assistant part ${index}`)
    requireExactKeys(part, ["type", "text"], `Packaged client session export assistant part ${index}`)
    if (part.type !== "text") throw new Error("Packaged client session export assistant part type is invalid")
    return { type: "text" as const, text: requireText(part.text, "Packaged client session export assistant part text") }
  })
  if (parts.map((part) => part.text).join("") !== output) {
    throw new Error("Packaged client session export assistant output does not match its parts")
  }
  if (
    !containsExactLine(output, server.terminalMarker) ||
    !parts.some((part) => containsExactLine(part.text, server.terminalMarker))
  ) {
    throw new Error("Packaged client session export assistant terminal marker is not an exact output line")
  }

  return {
    schemaVersion: 1,
    producer: {
      id: packagedClientProducer,
      product: packagedClientProduct,
      version: producer.version,
      platform: "darwin",
      arch: "arm64",
    },
    package: { fileName: packageMetadata.fileName, sha256: packageMetadata.sha256 },
    session: {
      runID: server.runID,
      completedAt: completedAt.value,
      assistant: { role: "assistant", output, parts },
    },
  }
}

function parseChecksumManifest(value: string) {
  if (!value.endsWith("\n") || value.includes("\r")) {
    throw new Error("Packaged client checksum manifest format is invalid")
  }
  const lines = value.slice(0, -1).split("\n")
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("Packaged client checksum manifest format is invalid")
  }
  const entries = lines.map((line) => {
    const match = /^([a-f0-9]{64})  ([^/\\\r\n]+)$/.exec(line)
    if (!match) throw new Error("Packaged client checksum manifest format is invalid")
    return { sha256: match[1], file: match[2] }
  })
  if (new Set(entries.map((entry) => entry.file)).size !== entries.length) {
    throw new Error("Packaged client checksum manifest contains duplicate entries")
  }
  const sorted = [...entries].sort((a, b) => a.file.localeCompare(b.file))
  if (entries.some((entry, index) => entry.file !== sorted[index].file)) {
    throw new Error("Packaged client checksum manifest entries are not sorted")
  }
  return entries
}

async function validatePackageArtifact(packagePath: string, format: "dmg" | "zip") {
  if (format === "dmg") {
    if (process.platform !== "darwin") throw new Error("DMG package validation requires macOS")
    await runCommand("/usr/bin/hdiutil", ["imageinfo", packagePath], "DMG image info")
    await runCommand("/usr/bin/hdiutil", ["verify", packagePath], "DMG verification")
    return
  }

  const signature = Buffer.from(await Bun.file(packagePath).slice(0, 4).arrayBuffer()).toString("hex")
  if (!new Set(["504b0304", "504b0506", "504b0708"]).has(signature)) {
    throw new Error("Packaged client ZIP signature is invalid")
  }
  await runCommand("/usr/bin/unzip", ["-t", packagePath], "ZIP verification")
  const listing = await runCommand("/usr/bin/unzip", ["-Z1", packagePath], "ZIP listing")
  const entries = listing.trimEnd().split("\n")
  if (
    entries.some(
      (entry) =>
        !entry || entry.startsWith("/") || entry.includes("\\") || entry.split("/").some((segment) => segment === ".."),
    )
  ) {
    throw new Error("Packaged client ZIP contains an invalid entry")
  }
  for (const expected of [
    "Guai Code Beta.app/Contents/Info.plist",
    "Guai Code Beta.app/Contents/MacOS/Guai Code Beta",
  ]) {
    if (!entries.includes(expected)) throw new Error(`Packaged client ZIP is missing ${expected}`)
  }
}

async function runCommand(command: string, args: string[], name: string) {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${name} failed: ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`)
  return stdout
}

function requirePackageIdentity(fileName: string) {
  const match = packageNamePattern.exec(fileName)
  if (!match) {
    throw new Error("Packaged client package name must be Guai-Code-Beta-<version>-mac-arm64.(dmg|zip)")
  }
  const format = match[2]
  if (format !== "dmg" && format !== "zip") throw new Error("Packaged client package format is invalid")
  return { version: match[1], format }
}

async function sha256(filePath: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(filePath).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
}

function requireRecord(value: unknown, name: string) {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error(`${name} fields are invalid`)
}

function requireAbsolutePath(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`Packaged client acknowledgment ${name} path is invalid`)
  }
}

function requireSha256(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Packaged client ${name} hash is invalid`)
  }
}

function requireText(value: unknown, name: string, maximumBytes = 1024 * 1024) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximumBytes) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

function containsExactLine(value: string, expected: string) {
  return value.split(/\r?\n/).includes(expected)
}

function requireTimestamp(value: unknown, name: string) {
  if (typeof value !== "string") throw new Error(`Soak evidence ${name} is invalid`)
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Soak evidence ${name} is invalid`)
  }
  return { value, millis: timestamp }
}

function requirePositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function requireNonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

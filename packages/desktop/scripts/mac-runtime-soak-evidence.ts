import path from "node:path"

export const DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS = 65 * 60_000
export const DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS = 15_000

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

export type MacRuntimeSoakPackagedClientAcknowledgment = {
  runID: string
  terminalMarker: string
  source: "packaged-client-transcript" | "packaged-client-log"
  sourcePath: string
  sourceSha256: string
  packagePath: string
  packageSha256: string
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

const acknowledgmentKeys = [
  "runID",
  "terminalMarker",
  "source",
  "sourcePath",
  "sourceSha256",
  "packagePath",
  "packageSha256",
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
  input: {
    source: "packaged-client-transcript" | "packaged-client-log"
    sourcePath: string
    packagePath: string
    acknowledgedAt?: string
  },
  policy: MacRuntimeSoakEvidencePolicy = {},
): Promise<MacRuntimeSoakEvidence> {
  const verifiedServer = assertMacRuntimeSoakServerEvidence(server, policy)
  const sourcePath = path.resolve(input.sourcePath)
  const packagePath = path.resolve(input.packagePath)
  const source = Bun.file(sourcePath)
  const packageArtifact = Bun.file(packagePath)
  if (!(await source.exists())) throw new Error("Packaged client acknowledgment source does not exist")
  if (!(await packageArtifact.exists())) throw new Error("Packaged client package artifact does not exist")
  const sourceText = await source.text()
  if (!sourceText.includes(verifiedServer.runID) || !sourceText.includes(verifiedServer.terminalMarker)) {
    throw new Error("Packaged client acknowledgment source does not contain the runID and terminal marker")
  }
  const packagedClientAcknowledgment = {
    runID: verifiedServer.runID,
    terminalMarker: verifiedServer.terminalMarker,
    source: input.source,
    sourcePath,
    sourceSha256: await sha256(sourcePath),
    packagePath,
    packageSha256: await sha256(packagePath),
    acknowledgedAt:
      input.acknowledgedAt ?? new Date(Math.max(Date.now(), Date.parse(verifiedServer.terminalAt))).toISOString(),
  } satisfies MacRuntimeSoakPackagedClientAcknowledgment
  return assertMacRuntimeSoakEvidence({ ...verifiedServer, packagedClientAcknowledgment }, policy)
}

export async function verifyMacRuntimeSoakEvidence(
  value: unknown,
  policy: MacRuntimeSoakEvidencePolicy = {},
): Promise<MacRuntimeSoakEvidence> {
  const evidence = assertMacRuntimeSoakEvidence(value, policy)
  const acknowledgment = evidence.packagedClientAcknowledgment
  const source = Bun.file(acknowledgment.sourcePath)
  const packageArtifact = Bun.file(acknowledgment.packagePath)
  if (!(await source.exists()) || !(await packageArtifact.exists())) {
    throw new Error("Packaged client acknowledgment artifacts are unavailable")
  }
  const sourceText = await source.text()
  if (!sourceText.includes(evidence.runID) || !sourceText.includes(evidence.terminalMarker)) {
    throw new Error("Packaged client acknowledgment source no longer contains the run evidence")
  }
  if ((await sha256(acknowledgment.sourcePath)) !== acknowledgment.sourceSha256) {
    throw new Error("Packaged client acknowledgment source hash does not match")
  }
  if ((await sha256(acknowledgment.packagePath)) !== acknowledgment.packageSha256) {
    throw new Error("Packaged client package hash does not match")
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
  if (acknowledgment.source !== "packaged-client-transcript" && acknowledgment.source !== "packaged-client-log") {
    throw new Error("Packaged client acknowledgment source is invalid")
  }
  if (typeof acknowledgment.sourcePath !== "string" || !path.isAbsolute(acknowledgment.sourcePath)) {
    throw new Error("Packaged client acknowledgment source path is invalid")
  }
  if (typeof acknowledgment.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(acknowledgment.sourceSha256)) {
    throw new Error("Packaged client acknowledgment source hash is invalid")
  }
  if (typeof acknowledgment.packagePath !== "string" || !path.isAbsolute(acknowledgment.packagePath)) {
    throw new Error("Packaged client acknowledgment package path is invalid")
  }
  if (typeof acknowledgment.packageSha256 !== "string" || !/^[a-f0-9]{64}$/.test(acknowledgment.packageSha256)) {
    throw new Error("Packaged client acknowledgment package hash is invalid")
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
      source: acknowledgment.source,
      sourcePath: acknowledgment.sourcePath,
      sourceSha256: acknowledgment.sourceSha256,
      packagePath: acknowledgment.packagePath,
      packageSha256: acknowledgment.packageSha256,
      acknowledgedAt: acknowledgedAt.value,
    },
  }
}

async function sha256(filePath: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(filePath).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

function requireRecord(value: unknown, name: string) {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requireExactKeys(value: Record<string, unknown>, keys: string[], name: string) {
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error(`${name} fields are invalid`)
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

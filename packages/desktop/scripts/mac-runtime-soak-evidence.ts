import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
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
  clientAcknowledged: boolean
  clientAbort: boolean
  completed: boolean
  disconnectReason: MacRuntimeSoakDisconnectReason
}

export type MacRuntimeSoakServerEvidence = Omit<
  MacRuntimeSoakObservation,
  "terminalAt" | "clientAcknowledged" | "clientAbort" | "completed" | "disconnectReason"
> & {
  terminalAt: string
  clientAcknowledged: true
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
  capture: {
    transport: "opencode-session-http"
    sessionID: string
    directory: string
    endpoint: string
    responseSha256: string
    runtimeAppPath: string
    runtimeCDHash: string
    listenerPID: number
    listenerExecutable: string
    appPID: number
  }
  session: {
    runID: string
    completedAt: string
    assistant: {
      role: "assistant"
      messageID: string
      sessionID: string
      providerID: string
      modelID: string
      output: string
      parts: { id: string; sessionID: string; messageID: string; type: "text"; text: string }[]
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

export type MacRuntimeSoakCaptureInput = {
  sourcePath: string
  manifestPath: string
  packagePath: string
  session: {
    endpoint: string
    sessionID: string
    directory: string
    runtimeAppPath: string
    headers?: Readonly<Record<string, string>>
  }
  fixture: {
    runID: string
    terminalMarker: string
    acknowledgmentEndpoint: string
    token: string
  }
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
  "clientAcknowledged",
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

  if (evidence.clientAcknowledged !== true) throw new Error("Soak client did not acknowledge the completed response")
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
    clientAcknowledged: true,
    clientAbort: false,
    completed: true,
    disconnectReason: "completed",
  }
}

export async function combineMacRuntimeSoakEvidence(
  server: unknown | PromiseLike<unknown>,
  input: MacRuntimeSoakCaptureInput,
  policy: MacRuntimeSoakEvidencePolicy = {},
): Promise<MacRuntimeSoakEvidence> {
  const expected = requireExpectedFixture(input.fixture)
  await capturePackagedClientSession(expected, input)
  await acknowledgeFixture(expected, input.fixture)
  const verifiedServer = assertMacRuntimeSoakServerEvidence(await server, policy)
  if (verifiedServer.runID !== expected.runID || verifiedServer.terminalMarker !== expected.terminalMarker) {
    throw new Error("Soak server evidence does not match the acknowledged fixture")
  }
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

async function capturePackagedClientSession(
  expected: { runID: string; terminalMarker: string },
  input: MacRuntimeSoakCaptureInput,
) {
  const packagePath = path.resolve(input.packagePath)
  const packageArtifact = Bun.file(packagePath)
  if (!(await packageArtifact.exists())) throw new Error("Packaged client package artifact does not exist")
  const packageIdentity = requirePackageIdentity(path.basename(packagePath))
  const packageSha256 = await sha256(packagePath)
  const endpoint = requireSessionEndpoint(input.session.endpoint, input.session.sessionID)
  if (!path.isAbsolute(input.session.directory)) {
    throw new Error("Packaged client session directory is invalid")
  }
  const runtime = await attestRuntimeListener(endpoint, input.session.runtimeAppPath, packageIdentity.version)
  const response = await fetch(endpoint, {
    headers: {
      ...input.session.headers,
      "x-opencode-directory": input.session.directory,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Packaged client session export request failed with ${response.status}`)
  const responseBody = await readBoundedResponse(response, sessionExportMaximumBytes)
  const assistant = extractAssistantOutput(
    parseJson(responseBody, "Packaged client session response"),
    expected,
    input.session.sessionID,
  )
  const sessionExport = {
    schemaVersion: 1,
    producer: {
      id: packagedClientProducer,
      product: packagedClientProduct,
      version: packageIdentity.version,
      platform: "darwin",
      arch: "arm64",
    },
    package: { fileName: path.basename(packagePath), sha256: packageSha256 },
    capture: {
      transport: "opencode-session-http",
      sessionID: input.session.sessionID,
      directory: input.session.directory,
      endpoint,
      responseSha256: sha256Text(responseBody),
      runtimeAppPath: runtime.appPath,
      runtimeCDHash: runtime.cdHash,
      listenerPID: runtime.listenerPID,
      listenerExecutable: runtime.listenerExecutable,
      appPID: runtime.appPID,
    },
    session: {
      runID: expected.runID,
      completedAt: assistant.completedAt,
      assistant: {
        role: "assistant",
        messageID: assistant.messageID,
        sessionID: assistant.sessionID,
        providerID: assistant.providerID,
        modelID: assistant.modelID,
        output: assistant.output,
        parts: assistant.parts,
      },
    },
  } satisfies MacRuntimeSoakSessionExport
  const sourcePath = path.resolve(input.sourcePath)
  await mkdir(path.dirname(sourcePath), { recursive: true })
  await Bun.write(sourcePath, `${JSON.stringify(sessionExport, null, 2)}\n`)
}

function requireExpectedFixture(value: MacRuntimeSoakCaptureInput["fixture"]) {
  if (typeof value.runID !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(value.runID)) {
    throw new Error("Soak fixture runID is invalid")
  }
  if (value.terminalMarker !== macRuntimeSoakTerminalMarker(value.runID)) {
    throw new Error("Soak fixture terminal marker is invalid")
  }
  return { runID: value.runID, terminalMarker: value.terminalMarker }
}

async function acknowledgeFixture(
  expected: { runID: string; terminalMarker: string },
  fixture: MacRuntimeSoakCaptureInput["fixture"],
) {
  const endpoint = requireAcknowledgmentEndpoint(fixture.acknowledgmentEndpoint, expected.runID)
  if (!fixture.token || Buffer.byteLength(fixture.token) > 4_096) throw new Error("Soak fixture token is invalid")
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
    body: JSON.stringify({ runID: expected.runID, terminalMarker: expected.terminalMarker }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Soak fixture acknowledgment failed with ${response.status}`)
  await response.body?.cancel()
}

function requireSessionEndpoint(value: string, sessionID: string) {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(sessionID)) throw new Error("Packaged client session ID is invalid")
  const endpoint = new URL(value)
  if (endpoint.protocol !== "http:" || !new Set(["127.0.0.1", "::1", "localhost"]).has(endpoint.hostname)) {
    throw new Error("Packaged client session endpoint must use loopback HTTP")
  }
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error("Packaged client session endpoint is invalid")
  }
  const encoded = encodeURIComponent(sessionID)
  if (endpoint.pathname !== `/session/${encoded}/message` && endpoint.pathname !== `/api/session/${encoded}/message`) {
    throw new Error("Packaged client session endpoint path is invalid")
  }
  return endpoint.toString()
}

function requireAcknowledgmentEndpoint(value: string, runID: string) {
  const endpoint = new URL(value)
  if (endpoint.protocol !== "http:" || !new Set(["127.0.0.1", "::1", "localhost"]).has(endpoint.hostname)) {
    throw new Error("Soak fixture acknowledgment endpoint must use loopback HTTP")
  }
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error("Soak fixture acknowledgment endpoint is invalid")
  }
  if (endpoint.pathname !== `/v1/runs/${encodeURIComponent(runID)}/acknowledgment`) {
    throw new Error("Soak fixture acknowledgment endpoint path is invalid")
  }
  return endpoint.toString()
}

async function attestRuntimeListener(endpoint: string, runtimeAppPath: string, version: string) {
  const appPath = await realpath(path.resolve(runtimeAppPath))
  const runtime = await validateAppBundle(appPath, version)
  const port = new URL(endpoint).port
  if (!port) throw new Error("Packaged client session endpoint port is missing")
  const listeners = await runCommand(
    "/usr/sbin/lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
    "Session listener inspection",
  )
  const listenerPIDs = [...new Set([...listeners.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])))]
  if (listenerPIDs.length !== 1) throw new Error("Packaged client session endpoint must have one listener process")
  const listenerPID = listenerPIDs[0]
  const listenerExecutable = await processExecutable(listenerPID)
  if (!isInsideApp(listenerExecutable, appPath)) {
    throw new Error("Packaged client session listener is not running from the packaged app")
  }
  const mainExecutable = await realpath(path.join(appPath, "Contents", "MacOS", packagedClientProduct))
  const appPID = await findAncestorProcess(listenerPID, mainExecutable, 8)
  if (appPID === undefined) throw new Error("Packaged client session listener is not owned by the packaged app")
  return { appPath, cdHash: runtime.cdHash, listenerPID, listenerExecutable, appPID }
}

async function processExecutable(pid: number) {
  const listing = await runCommand(
    "/usr/sbin/lsof",
    ["-a", "-p", String(pid), "-d", "txt", "-Fn"],
    "Process executable inspection",
  )
  const executable = listing
    .split("\n")
    .find((line) => line.startsWith("n/"))
    ?.slice(1)
  if (!executable) throw new Error("Packaged client listener executable is unavailable")
  return realpath(executable)
}

async function findAncestorProcess(
  pid: number,
  mainExecutable: string,
  remaining: number,
): Promise<number | undefined> {
  if (remaining < 0 || pid <= 1) return undefined
  if ((await processExecutable(pid)) === mainExecutable) return pid
  const parent = Number((await runCommand("/bin/ps", ["-p", String(pid), "-o", "ppid="], "Process ancestry")).trim())
  if (!Number.isSafeInteger(parent) || parent <= 0 || parent === pid) return undefined
  return findAncestorProcess(parent, mainExecutable, remaining - 1)
}

function isInsideApp(file: string, appPath: string) {
  const relative = path.relative(appPath, file)
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function readBoundedResponse(response: Response, maximumBytes: number) {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error("Packaged client session response is too large")
  }
  if (!response.body) throw new Error("Packaged client session response is empty")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const value = await reader.read()
    if (value.done) break
    bytes += value.value.byteLength
    if (bytes > maximumBytes) {
      await reader.cancel()
      throw new Error("Packaged client session response is too large")
    }
    chunks.push(value.value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
}

function extractAssistantOutput(
  value: unknown,
  expected: { runID: string; terminalMarker: string },
  sessionID: string,
) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100_000) {
    throw new Error("Packaged client session response must contain a bounded message array")
  }
  const matches = value.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.info) || item.info.role !== "assistant" || !Array.isArray(item.parts)) {
      return []
    }
    const info = item.info
    if (
      !validOpenCodeID(info.id, "msg_") ||
      info.sessionID !== sessionID ||
      !validOpenCodeID(info.parentID, "msg_") ||
      !validIdentifier(info.modelID) ||
      !validIdentifier(info.providerID) ||
      !validIdentifier(info.mode) ||
      !validIdentifier(info.agent) ||
      !isRecord(info.path) ||
      typeof info.path.cwd !== "string" ||
      typeof info.path.root !== "string" ||
      !path.isAbsolute(info.path.cwd) ||
      !path.isAbsolute(info.path.root) ||
      !validUsage(info.cost, info.tokens) ||
      info.error !== undefined
    ) {
      return []
    }
    const completed = isRecord(info.time) ? info.time.completed : undefined
    if (typeof completed !== "number" || !Number.isSafeInteger(completed) || completed < 0) return []
    const textParts = item.parts.filter((part) => isRecord(part) && part.type === "text" && part.ignored !== true)
    if (
      textParts.some(
        (part) =>
          !validOpenCodeID(part.id, "prt_") ||
          part.sessionID !== sessionID ||
          part.messageID !== info.id ||
          typeof part.text !== "string",
      )
    ) {
      return []
    }
    const parts = textParts.flatMap((part) => {
      if (typeof part.text !== "string" || !part.text.trim()) return []
      return [
        {
          id: part.id,
          sessionID,
          messageID: info.id,
          type: "text" as const,
          text: requireText(part.text, "Packaged client session text part"),
        },
      ]
    })
    if (parts.length === 0 || parts.length > 4_096) return []
    const output = parts.map((part) => part.text).join("")
    if (exactLineCount(output, expected.terminalMarker) !== 1) return []
    return [
      {
        completedAt: new Date(completed).toISOString(),
        messageID: info.id,
        sessionID,
        providerID: info.providerID,
        modelID: info.modelID,
        output,
        parts,
      },
    ]
  })
  if (matches.length !== 1) {
    throw new Error("Packaged client session response must contain exactly one completed assistant marker")
  }
  const completedAt = requireTimestamp(matches[0].completedAt, "captured session completedAt")
  return matches[0]
}

function validOpenCodeID(value: unknown, prefix: string) {
  return typeof value === "string" && value.startsWith(prefix) && /^[a-zA-Z0-9_-]{4,256}$/.test(value)
}

function validIdentifier(value: unknown) {
  return typeof value === "string" && Boolean(value.trim()) && Buffer.byteLength(value) <= 256
}

function validUsage(cost: unknown, tokens: unknown) {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || !isRecord(tokens)) return false
  if (!["input", "output", "reasoning"].every((key) => validFinite(tokens[key]))) return false
  if (!isRecord(tokens.cache)) return false
  return validFinite(tokens.cache.read) && validFinite(tokens.cache.write)
}

function validFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
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
  const packagedApp = await validatePackageArtifact(packagePath, packageIdentity)
  const runtimeApp = await validateAppBundle(sessionExport.capture.runtimeAppPath, packageIdentity.version)
  if (
    packagedApp.cdHash !== sessionExport.capture.runtimeCDHash ||
    runtimeApp.cdHash !== sessionExport.capture.runtimeCDHash
  ) {
    throw new Error("Packaged client runtime does not match the package artifact")
  }

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
  requireExactKeys(
    sessionExport,
    ["schemaVersion", "producer", "package", "capture", "session"],
    "Packaged client session export",
  )
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

  const capture = requireRecord(sessionExport.capture, "Packaged client session export capture")
  requireExactKeys(
    capture,
    [
      "transport",
      "sessionID",
      "directory",
      "endpoint",
      "responseSha256",
      "runtimeAppPath",
      "runtimeCDHash",
      "listenerPID",
      "listenerExecutable",
      "appPID",
    ],
    "Packaged client session export capture",
  )
  if (capture.transport !== "opencode-session-http") {
    throw new Error("Packaged client session export capture transport is invalid")
  }
  if (typeof capture.sessionID !== "string" || typeof capture.endpoint !== "string") {
    throw new Error("Packaged client session export capture session is invalid")
  }
  requireSessionEndpoint(capture.endpoint, capture.sessionID)
  if (typeof capture.directory !== "string" || !path.isAbsolute(capture.directory)) {
    throw new Error("Packaged client session export capture directory is invalid")
  }
  requireSha256(capture.responseSha256, "session response")
  if (
    typeof capture.runtimeAppPath !== "string" ||
    !path.isAbsolute(capture.runtimeAppPath) ||
    typeof capture.listenerExecutable !== "string" ||
    !path.isAbsolute(capture.listenerExecutable) ||
    typeof capture.runtimeCDHash !== "string" ||
    !/^[a-f0-9]{40}$/.test(capture.runtimeCDHash) ||
    typeof capture.listenerPID !== "number" ||
    !Number.isSafeInteger(capture.listenerPID) ||
    capture.listenerPID <= 1 ||
    typeof capture.appPID !== "number" ||
    !Number.isSafeInteger(capture.appPID) ||
    capture.appPID <= 1
  ) {
    throw new Error("Packaged client session export runtime capture is invalid")
  }
  if (!isInsideApp(capture.listenerExecutable, capture.runtimeAppPath)) {
    throw new Error("Packaged client session export listener is not inside the runtime app")
  }

  const session = requireRecord(sessionExport.session, "Packaged client session export session")
  requireExactKeys(session, ["runID", "completedAt", "assistant"], "Packaged client session export session")
  if (session.runID !== server.runID) throw new Error("Packaged client session export runID does not match")
  const completedAt = requireTimestamp(session.completedAt, "session export completedAt")
  if (completedAt.millis < Date.parse(server.terminalAt)) {
    throw new Error("Packaged client session export predates the terminal marker")
  }

  const assistant = requireRecord(session.assistant, "Packaged client session export assistant")
  requireExactKeys(
    assistant,
    ["role", "messageID", "sessionID", "providerID", "modelID", "output", "parts"],
    "Packaged client session export assistant",
  )
  if (assistant.role !== "assistant") throw new Error("Packaged client session export assistant role is invalid")
  if (
    !validOpenCodeID(assistant.messageID, "msg_") ||
    assistant.sessionID !== capture.sessionID ||
    !validIdentifier(assistant.providerID) ||
    !validIdentifier(assistant.modelID)
  ) {
    throw new Error("Packaged client session export assistant identity is invalid")
  }
  const output = requireText(assistant.output, "Packaged client session export assistant output", 16 * 1024 * 1024)
  if (!Array.isArray(assistant.parts) || assistant.parts.length === 0 || assistant.parts.length > 4_096) {
    throw new Error("Packaged client session export assistant parts are invalid")
  }
  const parts = assistant.parts.map((value, index) => {
    const part = requireRecord(value, `Packaged client session export assistant part ${index}`)
    requireExactKeys(
      part,
      ["id", "sessionID", "messageID", "type", "text"],
      `Packaged client session export assistant part ${index}`,
    )
    if (
      part.type !== "text" ||
      !validOpenCodeID(part.id, "prt_") ||
      part.sessionID !== capture.sessionID ||
      part.messageID !== assistant.messageID
    ) {
      throw new Error("Packaged client session export assistant part identity is invalid")
    }
    return {
      id: part.id,
      sessionID: capture.sessionID,
      messageID: assistant.messageID,
      type: "text" as const,
      text: requireText(part.text, "Packaged client session export assistant part text"),
    }
  })
  if (parts.map((part) => part.text).join("") !== output) {
    throw new Error("Packaged client session export assistant output does not match its parts")
  }
  if (exactLineCount(output, server.terminalMarker) !== 1) {
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
    capture: {
      transport: "opencode-session-http",
      sessionID: capture.sessionID,
      directory: capture.directory,
      endpoint: capture.endpoint,
      responseSha256: capture.responseSha256,
      runtimeAppPath: capture.runtimeAppPath,
      runtimeCDHash: capture.runtimeCDHash,
      listenerPID: capture.listenerPID,
      listenerExecutable: capture.listenerExecutable,
      appPID: capture.appPID,
    },
    session: {
      runID: server.runID,
      completedAt: completedAt.value,
      assistant: {
        role: "assistant",
        messageID: assistant.messageID,
        sessionID: capture.sessionID,
        providerID: assistant.providerID,
        modelID: assistant.modelID,
        output,
        parts,
      },
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

async function validatePackageArtifact(packagePath: string, identity: { version: string; format: "dmg" | "zip" }) {
  if (process.platform !== "darwin") throw new Error("Mac package validation requires macOS")
  const directory = await mkdtemp(path.join(tmpdir(), "guai-runtime-package-"))
  const mount = path.join(directory, "mount")
  const extracted = path.join(directory, "extracted")
  let mounted = false
  try {
    if (identity.format === "dmg") {
      await mkdir(mount)
      await runCommand("/usr/bin/hdiutil", ["imageinfo", packagePath], "DMG image info")
      await runCommand("/usr/bin/hdiutil", ["verify", packagePath], "DMG verification")
      await runCommand(
        "/usr/bin/hdiutil",
        ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, packagePath],
        "DMG mount",
      )
      mounted = true
      return await validateAppBundle(path.join(mount, "Guai Code Beta.app"), identity.version)
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
          !entry ||
          entry.startsWith("/") ||
          entry.includes("\\") ||
          entry.split("/").some((segment) => segment === ".."),
      )
    ) {
      throw new Error("Packaged client ZIP contains an invalid entry")
    }
    await mkdir(extracted)
    await runCommand("/usr/bin/ditto", ["-x", "-k", packagePath, extracted], "ZIP extraction")
    return await validateAppBundle(path.join(extracted, "Guai Code Beta.app"), identity.version)
  } finally {
    if (mounted) await runCommand("/usr/bin/hdiutil", ["detach", mount, "-force"], "DMG detach").catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
}

async function validateAppBundle(appPath: string, version: string) {
  const app = await lstat(appPath).catch(() => undefined)
  if (!app?.isDirectory() || app.isSymbolicLink()) {
    throw new Error("Packaged client image is missing a valid Guai Code Beta.app")
  }
  const info = path.join(appPath, "Contents", "Info.plist")
  const executableDirectory = path.join(appPath, "Contents", "MacOS")
  for (const item of [path.join(appPath, "Contents"), executableDirectory, info]) {
    if ((await lstat(item)).isSymbolicLink()) throw new Error("Packaged client app contains an invalid symlink")
  }
  const identifier = await plistValue(info, "CFBundleIdentifier")
  const name = await plistValue(info, "CFBundleName")
  const shortVersion = await plistValue(info, "CFBundleShortVersionString")
  const executableName = await plistValue(info, "CFBundleExecutable")
  if (identifier !== "com.guaicode.desktop.beta") throw new Error("Packaged client app Bundle ID is invalid")
  if (name !== packagedClientProduct) throw new Error("Packaged client app name is invalid")
  if (shortVersion !== version) throw new Error("Packaged client app version is invalid")
  if (executableName !== packagedClientProduct) throw new Error("Packaged client app executable name is invalid")
  const executable = path.join(executableDirectory, executableName)
  if ((await lstat(executable)).isSymbolicLink()) throw new Error("Packaged client app contains an invalid symlink")
  const file = await runCommand("/usr/bin/file", ["-b", executable], "App executable inspection")
  if (!file.includes("Mach-O") || !file.includes("arm64")) {
    throw new Error("Packaged client app executable is not an arm64 Mach-O")
  }
  await runCommand("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "App signature")
  const signature = await runCommand("/usr/bin/codesign", ["-d", "--verbose=4", appPath], "App signature identity")
  const cdHash = /^CDHash=([a-f0-9]{40})$/m.exec(signature)?.[1]
  if (!cdHash) throw new Error("Packaged client app CDHash is unavailable")
  return { appPath: await realpath(appPath), executable: await realpath(executable), cdHash }
}

async function plistValue(info: string, key: string) {
  return (await runCommand("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", info], `App ${key}`)).trim()
}

async function runCommand(command: string, args: string[], name: string) {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${name} failed: ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`)
  return stdout || stderr
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

function sha256Text(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex")
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

function exactLineCount(value: string, expected: string) {
  return value.split(/\r?\n/).filter((line) => line === expected).length
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

import { randomUUID } from "node:crypto"
import { open, readFile, rename, rm, type FileHandle } from "node:fs/promises"
import { dirname } from "node:path"
import {
  serializeProviderProfile,
  type ProductDefaultModelInput,
  type ProductOpenCodeProviderConfig,
  type ProductProviderProfile,
} from "@opencode-ai/app/product/model-center"
import type { DesktopRuntimePaths } from "../runtime-environment"

const SCHEMA_VERSION = 1
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

type RuntimeConfigFileSystem = {
  readonly open: typeof open
  readonly readFile: typeof readFile
  readonly rename: typeof rename
  readonly rm: typeof rm
  readonly syncDirectory: (directory: string) => Promise<void>
}

export type ProductRuntimeConfig = {
  readonly provider: Readonly<Record<string, ProductOpenCodeProviderConfig>>
  readonly enabled_providers: readonly string[]
  readonly disabled_providers: readonly string[]
  readonly model?: string
}

export function createProductRuntimeConfig(input: {
  readonly profiles: readonly ProductProviderProfile[]
  readonly defaultSelection: ProductDefaultModelInput | undefined
  readonly presentProfile: (profile: ProductProviderProfile) => ProductProviderProfile
}): ProductRuntimeConfig {
  const profiles = input.profiles.map((profile) => ({ source: profile, presented: input.presentProfile(profile) }))
  const requested = input.defaultSelection
  const explicit = requested
    ? profiles.flatMap((profile) =>
        profile.source.id === requested.profileID &&
        profile.source.models.some((model) => model.id === requested.modelID) &&
        profile.presented.models.some((model) => model.id === requested.modelID)
          ? [{ profile: profile.presented, modelID: requested.modelID }]
          : [],
      )[0]
    : undefined
  const selected =
    explicit ??
    profiles.flatMap((profile) =>
      profile.presented.models.length ? [{ profile: profile.presented, modelID: profile.presented.models[0].id }] : [],
    )[0]

  return Object.freeze({
    provider: Object.freeze(
      Object.fromEntries(
        profiles.map((profile) => [profile.presented.providerID, serializeProviderProfile(profile.presented)]),
      ),
    ),
    enabled_providers: Object.freeze(profiles.map((profile) => profile.presented.providerID)),
    disabled_providers: Object.freeze([]),
    ...(selected ? { model: `${selected.profile.providerID}/${selected.modelID}` } : {}),
  })
}

export function createProductRuntimeConfigCoordinator(input: {
  readonly paths: DesktopRuntimePaths
  readonly profiles: () => readonly ProductProviderProfile[]
  readonly defaultSelection: () => ProductDefaultModelInput | undefined
  readonly presentProfile: (profile: ProductProviderProfile) => ProductProviderProfile
  readonly now?: () => Date
  readonly randomUUID?: () => string
  readonly fileSystem?: Partial<RuntimeConfigFileSystem>
}) {
  let queue = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = queue.then(operation)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const snapshot = () => ({
    paths: input.paths,
    profiles: input.profiles(),
    defaultSelection: input.defaultSelection(),
    presentProfile: input.presentProfile,
    now: input.now,
    randomUUID: input.randomUUID,
    fileSystem: input.fileSystem,
  })

  return Object.freeze({
    write: () => enqueue(() => writeProductRuntimeConfig(snapshot())),
    reload: (restart: Parameters<typeof reloadProductRuntimeConfig>[0]["restart"]) =>
      enqueue(() => reloadProductRuntimeConfig({ ...snapshot(), restart })),
  })
}

export async function initializeProductRuntimeConfig<T>(input: {
  readonly write: () => Promise<T>
  readonly cleanup: () => Promise<void>
  readonly terminate: () => void
}) {
  return input.write().catch(async () => {
    await input.cleanup().catch(() => undefined)
    await Promise.resolve()
      .then(input.terminate)
      .catch(() => undefined)
    throw new Error("The model runtime could not be initialized.")
  })
}

export async function writeProductRuntimeConfig(input: {
  readonly paths: DesktopRuntimePaths
  readonly profiles: readonly ProductProviderProfile[]
  readonly defaultSelection: ProductDefaultModelInput | undefined
  readonly presentProfile: (profile: ProductProviderProfile) => ProductProviderProfile
  readonly now?: () => Date
  readonly randomUUID?: () => string
  readonly fileSystem?: Partial<RuntimeConfigFileSystem>
}) {
  const config = createProductRuntimeConfig(input)
  const generatedAt = (input.now?.() ?? new Date()).toISOString()
  const openFile = input.fileSystem?.open ?? open
  const fileSystem = {
    open: openFile,
    readFile: input.fileSystem?.readFile ?? readFile,
    rename: input.fileSystem?.rename ?? rename,
    rm: input.fileSystem?.rm ?? rm,
    syncDirectory:
      input.fileSystem?.syncDirectory ?? ((directory: string) => syncRuntimeDirectory(directory, openFile)),
  }
  const createUUID = input.randomUUID ?? randomUUID
  const counts = Object.freeze({
    profiles: input.profiles.length,
    providers: Object.keys(config.provider).length,
    models: Object.values(config.provider).reduce(
      (total, provider) => total + Object.keys(provider.models).length,
      0,
    ),
  })

  await writeAtomicJSON(input.paths.modelConfig, config, fileSystem, createUUID)
  await writeAtomicJSON(
    input.paths.manifest,
    Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      runtime: Object.freeze({
        root: input.paths.root,
        config: input.paths.config,
        data: input.paths.data,
        cache: input.paths.cache,
        state: input.paths.state,
        database: input.paths.database,
        modelConfig: input.paths.modelConfig,
      }),
      counts,
      selectedModel: config.model ?? null,
    }),
    fileSystem,
    createUUID,
  )
  await ensureMigrationMarker(
    input.paths.migrationMarker,
    Object.freeze({ schemaVersion: SCHEMA_VERSION, isolatedAt: generatedAt }),
    fileSystem,
    createUUID,
  )

  return Object.freeze({
    profileCount: counts.profiles,
    providerCount: counts.providers,
    modelCount: counts.models,
    selectedModel: config.model ?? null,
  })
}

export async function reloadProductRuntimeConfig(
  input: Parameters<typeof writeProductRuntimeConfig>[0] & {
    readonly restart: (result: Awaited<ReturnType<typeof writeProductRuntimeConfig>>) => Promise<unknown>
  },
) {
  const result = await writeProductRuntimeConfig(input)
  await input.restart(result)
  return result
}

async function writeAtomicJSON(
  path: string,
  value: unknown,
  fileSystem: RuntimeConfigFileSystem,
  createUUID: () => string,
) {
  const temporary = `${path}.tmp-${process.pid}-${createUUID()}`
  const file = await fileSystem.open(temporary, "wx")
  try {
    await writeSyncedJSON(file, value)
    await fileSystem.rename(temporary, path)
    await fileSystem.syncDirectory(dirname(path))
  } catch (error) {
    await cleanupTemporary(temporary, fileSystem).catch(() => undefined)
    throw error
  }
}

async function ensureMigrationMarker(
  path: string,
  value: unknown,
  fileSystem: RuntimeConfigFileSystem,
  createUUID: () => string,
) {
  const existing = await fileSystem.readFile(path, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  })
  if (existing !== undefined && validMigrationMarker(existing)) return
  await writeAtomicJSON(path, value, fileSystem, createUUID)
}

async function cleanupTemporary(path: string, fileSystem: RuntimeConfigFileSystem) {
  await fileSystem.rm(path, { force: true })
  await fileSystem.syncDirectory(dirname(path))
}

async function writeSyncedJSON(file: FileHandle, value: unknown) {
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : undefined
}

function validMigrationMarker(input: string) {
  try {
    const marker: unknown = JSON.parse(input)
    if (!isRecord(marker) || marker.schemaVersion !== SCHEMA_VERSION || typeof marker.isolatedAt !== "string") {
      return false
    }
    return ISO_TIMESTAMP.test(marker.isolatedAt) && !Number.isNaN(Date.parse(marker.isolatedAt))
  } catch {
    return false
  }
}

async function syncRuntimeDirectory(directory: string, openFile: typeof open) {
  const handle = await openFile(directory, "r").catch((error: unknown) => {
    if (unsupportedDirectorySync(error)) return undefined
    throw error
  })
  if (!handle) return
  try {
    await handle.sync().catch((error: unknown) => {
      if (unsupportedDirectorySync(error)) return
      throw error
    })
  } finally {
    await handle.close()
  }
}

function unsupportedDirectorySync(error: unknown) {
  const code = errorCode(error)
  if (["EBADF", "EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(code ?? "")) return true
  return process.platform === "win32" && (code === "EISDIR" || code === "EPERM")
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

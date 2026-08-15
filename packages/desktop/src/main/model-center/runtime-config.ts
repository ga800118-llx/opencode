import { randomUUID } from "node:crypto"
import { open, rename, rm, type FileHandle } from "node:fs/promises"
import {
  serializeProviderProfile,
  type ProductDefaultModelInput,
  type ProductOpenCodeProviderConfig,
  type ProductProviderProfile,
} from "@opencode-ai/app/product/model-center"
import type { DesktopRuntimePaths } from "../runtime-environment"

const SCHEMA_VERSION = 1

type RuntimeConfigFileSystem = {
  readonly open: typeof open
  readonly rename: typeof rename
  readonly rm: typeof rm
}

export type ProductRuntimeConfig = {
  readonly provider: Readonly<Record<string, ProductOpenCodeProviderConfig>>
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
    disabled_providers: Object.freeze([]),
    ...(selected ? { model: `${selected.profile.providerID}/${selected.modelID}` } : {}),
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
  const fileSystem = {
    open: input.fileSystem?.open ?? open,
    rename: input.fileSystem?.rename ?? rename,
    rm: input.fileSystem?.rm ?? rm,
  }
  const createUUID = input.randomUUID ?? randomUUID
  const counts = Object.freeze({
    profiles: input.profiles.length,
    providers: Object.keys(config.provider).length,
    models: Object.values(config.provider).reduce((total, provider) => total + Object.keys(provider.models).length, 0),
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
  await writeOnceJSON(
    input.paths.migrationMarker,
    Object.freeze({ schemaVersion: SCHEMA_VERSION, isolatedAt: generatedAt }),
    fileSystem,
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
  } catch (error) {
    await fileSystem.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function writeOnceJSON(path: string, value: unknown, fileSystem: RuntimeConfigFileSystem) {
  const file = await fileSystem.open(path, "wx").catch((error: unknown) => {
    if (errorCode(error) === "EEXIST") return undefined
    throw error
  })
  if (!file) return
  try {
    await writeSyncedJSON(file, value)
  } catch (error) {
    await fileSystem.rm(path, { force: true }).catch(() => undefined)
    throw error
  }
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

import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const forbiddenEnvironmentKeys = ["OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT"] as const

export type DesktopRuntimePaths = {
  readonly root: string
  readonly config: string
  readonly data: string
  readonly cache: string
  readonly state: string
  readonly database: string
  readonly modelConfig: string
  readonly manifest: string
  readonly migrationMarker: string
}

export function createDesktopRuntimePaths(userDataPath: string): DesktopRuntimePaths {
  const root = join(userDataPath, "runtime")
  const config = join(root, "config")
  const data = join(root, "data")

  return {
    root,
    config,
    data,
    cache: join(root, "cache"),
    state: join(root, "state"),
    database: join(data, "opencode.db"),
    modelConfig: join(config, "model-profiles.json"),
    manifest: join(root, "manifest.json"),
    migrationMarker: join(root, "migration-v1.json"),
  }
}

export function createDesktopRuntimeEnvironment(
  paths: DesktopRuntimePaths,
  inherited: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(inherited).flatMap(([key, value]) =>
        value === undefined || isForbiddenDesktopRuntimeEnvironmentKey(key) ? [] : [[key, value]],
      ),
    ),
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_DB: paths.database,
    OPENCODE_CONFIG: paths.modelConfig,
    OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL: "1",
  }
}

export function installDesktopRuntimeEnvironment(
  paths: DesktopRuntimePaths,
  environment: Record<string, string | undefined> = process.env,
) {
  clearForbiddenDesktopRuntimeEnvironment(environment)
  Object.assign(environment, createDesktopRuntimeEnvironment(paths, environment))
}

export function clearForbiddenDesktopRuntimeEnvironment(environment: Record<string, string | undefined>) {
  forbiddenEnvironmentKeys.forEach((key) => delete environment[key])
}

export function isForbiddenDesktopRuntimeEnvironmentKey(key: string) {
  return forbiddenEnvironmentKeys.some((forbidden) => forbidden === key)
}

export async function ensureDesktopRuntime(paths: DesktopRuntimePaths): Promise<void> {
  await Promise.all([paths.config, paths.data, paths.cache, paths.state].map((path) => mkdir(path, { recursive: true })))
}

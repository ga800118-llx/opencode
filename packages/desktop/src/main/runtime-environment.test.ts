import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createDesktopRuntimeEnvironment,
  createDesktopRuntimePaths,
  ensureDesktopRuntime,
} from "./runtime-environment"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("desktop runtime replaces inherited persistence paths", () => {
  const userDataPath = join(tmpdir(), "guai-code-user-data")
  const paths = createDesktopRuntimePaths(userDataPath)
  const environment = createDesktopRuntimeEnvironment(paths, {
    PATH: "/shell/bin",
    UNDEFINED_VALUE: undefined,
    XDG_CONFIG_HOME: join("~", ".config"),
    XDG_DATA_HOME: join("~", ".local", "share"),
    XDG_CACHE_HOME: join("~", ".cache"),
    XDG_STATE_HOME: join("~", ".local", "state"),
    OPENCODE_DB: join("~", ".local", "share", "opencode", "opencode.db"),
    OPENCODE_CONFIG: join("~", ".config", "opencode", "opencode.json"),
  })

  expect(paths).toEqual({
    root: join(userDataPath, "runtime"),
    config: join(userDataPath, "runtime", "config"),
    data: join(userDataPath, "runtime", "data"),
    cache: join(userDataPath, "runtime", "cache"),
    state: join(userDataPath, "runtime", "state"),
    database: join(userDataPath, "runtime", "data", "opencode.db"),
    modelConfig: join(userDataPath, "runtime", "config", "model-profiles.json"),
    manifest: join(userDataPath, "runtime", "manifest.json"),
    migrationMarker: join(userDataPath, "runtime", "migration-v1.json"),
  })
  expect(environment).toMatchObject({
    PATH: "/shell/bin",
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_DB: paths.database,
    OPENCODE_CONFIG: paths.modelConfig,
  })
  expect("UNDEFINED_VALUE" in environment).toBe(false)
})

test("onboarding runtime stays under its isolated user data root", () => {
  const onboardingRoot = join(tmpdir(), "opencode-onboarding-test")
  const paths = createDesktopRuntimePaths(join(onboardingRoot, "desktop"))

  expect(paths.root).toBe(join(onboardingRoot, "desktop", "runtime"))
  expect(Object.values(paths).every((path) => path.startsWith(join(onboardingRoot, "desktop")))).toBe(true)
})

test("ensureDesktopRuntime creates every runtime directory recursively", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "guai-code-runtime-"))
  temporaryDirectories.push(temporaryDirectory)
  const paths = createDesktopRuntimePaths(join(temporaryDirectory, "nested", "user-data"))

  await ensureDesktopRuntime(paths)

  const directories = await Promise.all([paths.root, paths.config, paths.data, paths.cache, paths.state].map(stat))
  expect(directories.every((entry) => entry.isDirectory())).toBe(true)
})

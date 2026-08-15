import { expect, test } from "bun:test"
import { join } from "node:path"
import { createDesktopRuntimeEnvironment, createDesktopRuntimePaths } from "./runtime-environment"
import type { SidecarListener } from "./server"
import { createSidecarEnv, prepareSidecarEnv } from "./sidecar-environment"

test("SidecarListener exposes typed process completion", async () => {
  let stops = 0
  const listener: SidecarListener = {
    exit: Promise.resolve(17),
    async stop() {
      stops += 1
    },
  }

  expect(await listener.exit).toBe(17)
  await listener.stop()
  expect(stops).toBe(1)
})

test("createSidecarEnv keeps the explicit desktop runtime authoritative", () => {
  const paths = createDesktopRuntimePaths(join("tmp", "desktop"))
  const environment = createDesktopRuntimeEnvironment(paths, {
    PATH: "/bundled-git:/shell/bin",
    GIT_EXEC_PATH: "/bundled-git/libexec",
    AGENT_PROFILE_ONE_API_KEY: "test-secret",
    OPENCODE_CONFIG_DIR: "/shared/explicit-config",
    OPENCODE_CONFIG_CONTENT: '{"provider":{"explicit":{}}}',
    DEBUG: "private-debug",
    LD_PRELOAD: "linux-only",
  })
  const parent = {
    PATH: "/bin",
    XDG_CONFIG_HOME: "/shared/config",
    XDG_DATA_HOME: "/shared/data",
    XDG_CACHE_HOME: "/shared/cache",
    XDG_STATE_HOME: "/shared/state",
    OPENCODE_DB: "/shared/opencode.db",
    OPENCODE_CONFIG: "/shared/opencode.json",
    OPENCODE_CONFIG_DIR: "/shared/parent-config",
    OPENCODE_CONFIG_CONTENT: '{"provider":{"parent":{}}}',
  }
  const child = createSidecarEnv(environment, parent, "linux")

  expect(child).toMatchObject({
    PATH: "/bundled-git:/shell/bin",
    GIT_EXEC_PATH: "/bundled-git/libexec",
    AGENT_PROFILE_ONE_API_KEY: "test-secret",
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_DB: paths.database,
    OPENCODE_CONFIG: paths.modelConfig,
  })
  expect(child.DEBUG).toBeUndefined()
  expect(child.LD_PRELOAD).toBeUndefined()
  expect(child.OPENCODE_CONFIG_DIR).toBeUndefined()
  expect(child.OPENCODE_CONFIG_CONTENT).toBeUndefined()
  expect(parent.XDG_CONFIG_HOME).toBe("/shared/config")
})

test("prepareSidecarEnv requires the complete desktop runtime", () => {
  const environment = {
    XDG_CONFIG_HOME: "/runtime/config",
    XDG_DATA_HOME: "/runtime/data",
    XDG_CACHE_HOME: "/runtime/cache",
  }

  expect(() => prepareSidecarEnv("test-password", environment)).toThrow(
    "Missing required sidecar environment: XDG_STATE_HOME, OPENCODE_DB, OPENCODE_CONFIG",
  )
  expect(environment).toEqual({
    XDG_CONFIG_HOME: "/runtime/config",
    XDG_DATA_HOME: "/runtime/data",
    XDG_CACHE_HOME: "/runtime/cache",
  })
})

test("prepareSidecarEnv only adds server credentials to a valid runtime", () => {
  const environment = createDesktopRuntimeEnvironment(createDesktopRuntimePaths(join("tmp", "desktop")))
  environment.OPENCODE_CONFIG_DIR = "/shared/config"
  environment.OPENCODE_CONFIG_CONTENT = '{"provider":{"shared":{}}}'
  const before = { ...environment }
  delete before.OPENCODE_CONFIG_DIR
  delete before.OPENCODE_CONFIG_CONTENT

  prepareSidecarEnv("test-password", environment)

  expect(environment).toEqual({
    ...before,
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: "test-password",
  })
})

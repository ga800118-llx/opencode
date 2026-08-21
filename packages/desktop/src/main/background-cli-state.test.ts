import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createBackgroundCliEnvironment, createBackgroundCliStatePlan } from "./background-cli-state"

describe("background CLI state plan", () => {
  test("selects only the desktop runtime state root", () => {
    const runtimeStateHome = join("user-data", "runtime", "state")

    const plan = createBackgroundCliStatePlan(runtimeStateHome)

    expect(plan).toEqual({ stateHome: runtimeStateHome })
    expect(Object.values(plan)).not.toContain(join("shared", "state"))
    expect(Object.values(plan)).not.toContain(join("shell", "state"))
  })

  test("builds every V2 child environment from the complete desktop runtime", () => {
    const runtimeRoot = join("user-data", "runtime")
    const runtimeStateHome = join(runtimeRoot, "state")
    const inherited = {
      PATH: "/bundled-git:/shell/bin",
      XDG_CONFIG_HOME: join(runtimeRoot, "config"),
      XDG_DATA_HOME: join(runtimeRoot, "data"),
      XDG_CACHE_HOME: join(runtimeRoot, "cache"),
      XDG_STATE_HOME: join("shell", "shared-state"),
      OPENCODE_DB: join(runtimeRoot, "data", "opencode.db"),
      OPENCODE_CONFIG: join(runtimeRoot, "config", "model-profiles.json"),
      OPENCODE_DESKTOP_MODEL_CONFIG: join(runtimeRoot, "config", "model-profiles.json"),
      OPENCODE_CONFIG_DIR: join("shared", "config"),
      OPENCODE_CONFIG_CONTENT: '{"provider":{"shared":{}}}',
      AGENT_PROFILE_PROFILE_ONE_API_KEY: "test-credential",
      UNDEFINED_VALUE: undefined,
    }

    const environment = createBackgroundCliEnvironment(runtimeStateHome, inherited)

    expect(environment).toMatchObject({
      PATH: "/bundled-git:/shell/bin",
      XDG_CONFIG_HOME: join(runtimeRoot, "config"),
      XDG_DATA_HOME: join(runtimeRoot, "data"),
      XDG_CACHE_HOME: join(runtimeRoot, "cache"),
      XDG_STATE_HOME: runtimeStateHome,
      OPENCODE_DB: join(runtimeRoot, "data", "opencode.db"),
      OPENCODE_CONFIG: join(runtimeRoot, "config", "model-profiles.json"),
      OPENCODE_DESKTOP_MODEL_CONFIG: join(runtimeRoot, "config", "model-profiles.json"),
      AGENT_PROFILE_PROFILE_ONE_API_KEY: "test-credential",
    })
    expect("UNDEFINED_VALUE" in environment).toBe(false)
    expect("OPENCODE_CONFIG_DIR" in environment).toBe(false)
    expect("OPENCODE_CONFIG_CONTENT" in environment).toBe(false)
    expect(inherited.XDG_STATE_HOME).toBe(join("shell", "shared-state"))
  })

  test("rejects an incomplete V2 runtime environment", () => {
    expect(() =>
      createBackgroundCliEnvironment(join("user-data", "runtime", "state"), {
        XDG_CONFIG_HOME: join("user-data", "runtime", "config"),
      }),
    ).toThrow(
      "Missing required V2 sidecar environment: XDG_DATA_HOME, XDG_CACHE_HOME, OPENCODE_DB, OPENCODE_CONFIG, OPENCODE_DESKTOP_MODEL_CONFIG",
    )
  })
})

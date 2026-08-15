import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { startBackgroundCliLifecycle } from "./background-cli-lifecycle"

describe("background CLI lifecycle", () => {
  test("restarts on startup, refreshes credentials, and stops the managed daemon", async () => {
    const calls: Array<{ command: string; token: string; redact: boolean }> = []
    let token = "token-one"
    const url = "http://127.0.0.1:4096"
    const controller = await startBackgroundCliLifecycle({
      runtimeStateHome: join("user-data", "runtime", "state"),
      environment: () => runtimeEnvironment(token),
      run: async (args, environment, options) => {
        calls.push({
          command: args.join(" "),
          token: environment.AGENT_PROFILE_PROFILE_ONE_API_KEY ?? "",
          redact: options?.redact ?? false,
        })
        if (args[1] === "restart") return url
        if (args[1] === "get") return `${token}-password`
        return ""
      },
    })

    expect(controller).toMatchObject({ url, username: "opencode", password: "token-one-password" })
    expect(calls).toEqual([
      { command: "service restart", token: "token-one", redact: false },
      { command: "service get password", token: "token-one", redact: true },
    ])

    token = "token-two"
    await controller.restart()

    expect(controller.password).toBe("token-two-password")
    expect(calls.slice(2)).toEqual([
      { command: "service restart", token: "token-two", redact: false },
      { command: "service get password", token: "token-two", redact: true },
    ])

    token = "token-three"
    await controller.stop()

    expect(calls.at(-1)).toEqual({ command: "service stop", token: "token-three", redact: false })
  })

  test("stops a replacement daemon and fails when restart changes the endpoint", async () => {
    const originalURL = "http://127.0.0.1:4096"
    const replacementURL = "http://127.0.0.1:5096"
    const urls = [originalURL, replacementURL]
    const commands: string[] = []
    const controller = await startBackgroundCliLifecycle({
      runtimeStateHome: join("user-data", "runtime", "state"),
      environment: () => runtimeEnvironment("token-one"),
      run: async (args) => {
        commands.push(args.join(" "))
        if (args[1] === "restart") return urls.shift() ?? replacementURL
        if (args[1] === "get") return "test-password"
        return ""
      },
    })

    await expect(controller.restart()).rejects.toThrow(
      `V2 sidecar restart changed endpoint from ${originalURL} to ${replacementURL}; replacement was stopped.`,
    )
    expect(commands).toEqual([
      "service restart",
      "service get password",
      "service restart",
      "service stop",
    ])
  })
})

function runtimeEnvironment(token: string) {
  const root = join("user-data", "runtime")
  return {
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    OPENCODE_DB: join(root, "data", "opencode.db"),
    OPENCODE_CONFIG: join(root, "config", "model-profiles.json"),
    AGENT_PROFILE_PROFILE_ONE_API_KEY: token,
  }
}

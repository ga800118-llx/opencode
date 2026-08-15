import { createBackgroundCliEnvironment } from "./background-cli-state"

export type BackgroundCliController = {
  readonly url: string
  readonly username: "opencode"
  readonly password: string
  readonly restart: () => Promise<void>
  readonly stop: () => Promise<void>
}

type BackgroundCliCommandOptions = {
  readonly redact?: boolean
}

type BackgroundCliLifecycleOptions = {
  readonly runtimeStateHome: string
  readonly environment: () => Readonly<Record<string, string | undefined>>
  readonly run: (
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    options?: BackgroundCliCommandOptions,
  ) => Promise<string>
}

export async function startBackgroundCliLifecycle(
  options: BackgroundCliLifecycleOptions,
): Promise<BackgroundCliController> {
  const environment = createBackgroundCliEnvironment(options.runtimeStateHome, options.environment())
  const url = await options.run(["service", "restart"], environment)
  let password = await options.run(["service", "get", "password"], environment, { redact: true })

  return {
    url,
    username: "opencode",
    get password() {
      return password
    },
    async restart() {
      const environment = createBackgroundCliEnvironment(options.runtimeStateHome, options.environment())
      const replacementURL = await options.run(["service", "restart"], environment)
      if (replacementURL !== url) {
        await options.run(["service", "stop"], environment)
        throw new Error(
          `V2 sidecar restart changed endpoint from ${url} to ${replacementURL}; replacement was stopped.`,
        )
      }
      password = await options.run(["service", "get", "password"], environment, { redact: true })
    },
    async stop() {
      await options.run(
        ["service", "stop"],
        createBackgroundCliEnvironment(options.runtimeStateHome, options.environment()),
      )
    },
  }
}

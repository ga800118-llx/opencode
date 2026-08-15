import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { app } from "electron"
import { startBackgroundCliLifecycle } from "./background-cli-lifecycle"
import { createBackgroundCliEnvironment, createBackgroundCliStatePlan } from "./background-cli-state"

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))

type Logger = {
  log(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export async function startBackgroundCli(
  logger: Logger,
  options: {
    readonly environment: () => Readonly<Record<string, string>>
    readonly runtimeStateHome: string
  },
) {
  const statePlan = createBackgroundCliStatePlan(options.runtimeStateHome)
  const bundled = app.isPackaged
    ? join(process.resourcesPath, executableName())
    : join(root, "../../resources", executableName())
  logger.log("v2 CLI executable resolved", { bundled, packaged: app.isPackaged })
  const version = await run(
    bundled,
    ["--version"],
    logger,
    createBackgroundCliEnvironment(statePlan.stateHome, options.environment()),
  )
  const binary = app.isPackaged ? await installCli(bundled, version, logger) : bundled

  const controller = await startBackgroundCliLifecycle({
    runtimeStateHome: statePlan.stateHome,
    environment: options.environment,
    run: (args, environment, commandOptions) => run(binary, args, logger, environment, commandOptions),
  })
  logger.log("v2 CLI background service ready", {
    username: controller.username,
    ...endpoint(controller.url),
  })
  return controller
}

async function installCli(source: string, version: string, logger: Logger) {
  const directory = join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = join(directory, executableName())
  if (existsSync(destination)) {
    logger.log("v2 CLI staged executable reused", { path: destination, version })
    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await copyFile(source, temp)
  if (process.platform !== "win32") await chmod(temp, 0o755)
  await rename(temp, destination).catch(async (error) => {
    await rm(temp, { force: true })
    throw error
  })
  logger.log("v2 CLI executable staged", { source, path: destination, version })
  return destination
}

async function run(
  binary: string,
  args: readonly string[],
  logger: Logger,
  environment: Readonly<Record<string, string>>,
  options: { redact?: boolean } = {},
) {
  logger.log("v2 CLI command started", { binary, args })
  return execFileAsync(binary, args, { env: environment, windowsHide: true }).then(
    (result) => {
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()
      logger.log("v2 CLI command completed", { args, stdout: options.redact ? "[redacted]" : stdout, stderr })
      return stdout
    },
    (error: unknown) => {
      const output = error as { stdout?: string; stderr?: string }
      logger.error("v2 CLI command failed", {
        args,
        error: error instanceof Error ? error.message : String(error),
        stdout: options.redact && output.stdout ? "[redacted]" : (output.stdout?.trim() ?? ""),
        stderr: output.stderr?.trim() ?? "",
      })
      throw error
    },
  )
}

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}

function executableName() {
  return process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"
}

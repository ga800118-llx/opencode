export function createSidecarEnv(
  environment: Readonly<Record<string, string>> = {},
  parent: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(parent).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  Object.assign(result, environment)
  delete result.DEBUG
  if (platform === "linux") delete result.LD_PRELOAD
  return result
}

export function prepareSidecarEnv(
  password: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const missing = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "OPENCODE_DB",
    "OPENCODE_CONFIG",
  ].filter((key) => !environment[key])
  if (missing.length > 0) throw new Error(`Missing required sidecar environment: ${missing.join(", ")}`)

  Object.assign(environment, {
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
  })
}

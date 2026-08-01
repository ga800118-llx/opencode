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

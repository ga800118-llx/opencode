export type BackgroundCliStatePlan = {
  readonly stateHome: string
}

export function createBackgroundCliStatePlan(runtimeStateHome: string): BackgroundCliStatePlan {
  return { stateHome: runtimeStateHome }
}

export function createBackgroundCliEnvironment(
  runtimeStateHome: string,
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(inherited).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
    ),
    XDG_STATE_HOME: runtimeStateHome,
  }
  const missing = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "OPENCODE_DB",
    "OPENCODE_CONFIG",
  ].filter((key) => !environment[key])
  if (missing.length > 0) throw new Error(`Missing required V2 sidecar environment: ${missing.join(", ")}`)
  return environment
}

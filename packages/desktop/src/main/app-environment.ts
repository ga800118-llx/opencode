import { isForbiddenDesktopRuntimeEnvironmentKey } from "./runtime-environment"

export function applyPreferredAppEnv(
  environment: Record<string, string | undefined>,
  shellEnv: Record<string, string> | null,
) {
  Object.assign(environment, {
    ...Object.fromEntries(
      Object.entries(shellEnv ?? {}).filter(
        ([key]) =>
          ![
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "XDG_STATE_HOME",
            "OPENCODE_DB",
            "OPENCODE_CONFIG",
            "OPENCODE_DESKTOP_MODEL_CONFIG",
            "GUAI_CODE_INTERNAL_PACKAGE_SMOKE",
          ].includes(key) && !isForbiddenDesktopRuntimeEnvironmentKey(key),
      ),
    ),
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
  })
}

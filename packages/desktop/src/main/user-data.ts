import { join, resolve } from "node:path"

type DesktopUserDataPathInput = {
  readonly appDataPath: string
  readonly dataNamespace: string
  readonly commandLineOverride?: string
  readonly onboardingRoot?: string
}

export function resolveDesktopUserDataPath(input: DesktopUserDataPathInput) {
  if (input.onboardingRoot) return join(input.onboardingRoot, "desktop")
  const override = input.commandLineOverride?.trim()
  if (override) return resolve(override)
  return join(input.appDataPath, input.dataNamespace)
}

import { expect, test } from "bun:test"
import { applyPreferredAppEnv } from "./app-environment"

test("preferred shell environment cannot inject the internal package smoke flag", () => {
  const environment: Record<string, string | undefined> = { PATH: "/desktop/bin" }

  applyPreferredAppEnv(environment, {
    PATH: "/shell/bin",
    GUAI_CODE_INTERNAL_PACKAGE_SMOKE: "1",
  })

  expect(environment.PATH).toBe("/shell/bin")
  expect(environment.GUAI_CODE_INTERNAL_PACKAGE_SMOKE).toBeUndefined()
})

test("preferred shell environment preserves an inherited internal package smoke flag", () => {
  const environment: Record<string, string | undefined> = { GUAI_CODE_INTERNAL_PACKAGE_SMOKE: "1" }

  applyPreferredAppEnv(environment, { GUAI_CODE_INTERNAL_PACKAGE_SMOKE: "shell-value" })

  expect(environment.GUAI_CODE_INTERNAL_PACKAGE_SMOKE).toBe("1")
})

test("preferred shell environment preserves the desktop model policy path", () => {
  const environment: Record<string, string | undefined> = {
    OPENCODE_DESKTOP_MODEL_CONFIG: "/desktop/runtime/config/opencode/opencode.json",
  }

  applyPreferredAppEnv(environment, {
    OPENCODE_DESKTOP_MODEL_CONFIG: "/shell/config/opencode/opencode.json",
  })

  expect(environment.OPENCODE_DESKTOP_MODEL_CONFIG).toBe("/desktop/runtime/config/opencode/opencode.json")
})

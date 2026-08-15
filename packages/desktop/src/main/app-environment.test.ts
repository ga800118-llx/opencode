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

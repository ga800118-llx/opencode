import { expect, test } from "bun:test"
import { configureCACertificates } from "./ca-certificates"

test("loads system certificates during normal startup", () => {
  const requested: string[] = []
  let configured: string[] = []

  configureCACertificates({
    environment: {},
    get(type) {
      requested.push(type)
      return type === "default" ? ["default", "shared"] : ["system", "shared"]
    },
    set(certificates) {
      configured = certificates
    },
  })

  expect(requested).toEqual(["default", "system"])
  expect(configured).toEqual(["default", "shared", "system"])
})

test("does not touch the macOS system keychain during isolated package smoke", () => {
  const requested: string[] = []

  configureCACertificates({
    environment: { GUAI_CODE_INTERNAL_PACKAGE_SMOKE: "1" },
    get(type) {
      requested.push(type)
      return ["default"]
    },
    set() {},
  })

  expect(requested).toEqual(["default"])
})

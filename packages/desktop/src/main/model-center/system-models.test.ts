import { describe, expect, test } from "bun:test"
import { SYSTEM_MODEL_IDS, SYSTEM_PROVIDER_CONFIG, SYSTEM_PROVIDER_ID } from "./system-models"

describe("system models", () => {
  test("keeps exactly five no-configuration models in product order", () => {
    expect(SYSTEM_PROVIDER_ID).toBe("opencode")
    expect(SYSTEM_MODEL_IDS).toEqual([
      "nemotron-3.5-lightning-free",
      "deepseek-v4-flash-free",
      "laguna-s-2.1-free",
      "hy3-free",
      "nemotron-3-ultra-free",
    ])
    expect(SYSTEM_PROVIDER_CONFIG).toEqual({ whitelist: SYSTEM_MODEL_IDS })
    expect(Object.isFrozen(SYSTEM_MODEL_IDS)).toBe(true)
    expect(Object.isFrozen(SYSTEM_PROVIDER_CONFIG)).toBe(true)
  })
})

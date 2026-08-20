export const SYSTEM_PROVIDER_ID = "opencode"

export const SYSTEM_MODEL_IDS = Object.freeze([
  "nemotron-3.5-lightning-free",
  "deepseek-v4-flash-free",
  "laguna-s-2.1-free",
  "hy3-free",
  "nemotron-3-ultra-free",
])

export const SYSTEM_PROVIDER_CONFIG = Object.freeze({ whitelist: SYSTEM_MODEL_IDS })
export const SYSTEM_DEFAULT_MODEL = `${SYSTEM_PROVIDER_ID}/${SYSTEM_MODEL_IDS[0]}`

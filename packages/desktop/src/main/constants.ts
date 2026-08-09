import { app } from "electron"
import { productUpdaterEnabled } from "../product/updater-policy"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATER_ENABLED = productUpdaterEnabled({
  packaged: app.isPackaged,
  channel: CHANNEL,
  explicitlyEnabled: import.meta.env.OPENCODE_UPDATER_ENABLED === "true",
})

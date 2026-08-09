import type { ProductChannel } from "./identity"

export function productUpdaterEnabled(input: {
  readonly packaged: boolean
  readonly channel: ProductChannel
  readonly explicitlyEnabled: boolean
}) {
  return input.packaged && input.channel === "prod" && input.explicitlyEnabled
}

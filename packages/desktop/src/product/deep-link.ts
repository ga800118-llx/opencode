import type { ProductIdentity } from "./identity"

const internalProtocolScheme = "opencode"

export function normalizeProductDeepLinks(identity: ProductIdentity, inputs: readonly string[]) {
  return inputs
    .map((input) => normalizeProductDeepLink(identity, input))
    .filter((input): input is string => input !== undefined)
}

function normalizeProductDeepLink(identity: ProductIdentity, input: string) {
  const prefix = `${identity.protocolScheme}://`
  if (!input.startsWith(prefix)) return
  try {
    decodeURI(input)
    if (new URL(input).protocol !== `${identity.protocolScheme}:`) return
  } catch {
    return
  }
  return `${internalProtocolScheme}://${input.slice(prefix.length)}`
}

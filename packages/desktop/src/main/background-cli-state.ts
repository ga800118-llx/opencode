import { join } from "node:path"
import type { ProductIdentity } from "../product/identity"

type BackgroundCliStatePlanInput = {
  readonly identity: ProductIdentity
  readonly environmentStateHome?: string
  readonly shellStateHome?: string
  readonly appDataPath: string
  readonly userDataPath: string
  readonly exists: (path: string) => boolean
}

export type BackgroundCliStatePlan = {
  readonly discoveryCandidates: readonly (string | undefined)[]
  readonly fallbackDaemonStateHome: string | undefined
}

export function createBackgroundCliStatePlan(input: BackgroundCliStatePlanInput): BackgroundCliStatePlan {
  if (input.identity.channel === "dev") {
    return {
      discoveryCandidates: [input.userDataPath],
      fallbackDaemonStateHome: input.userDataPath,
    }
  }

  return {
    discoveryCandidates: [
      ...new Set([
        input.environmentStateHome,
        input.shellStateHome,
        ...input.identity.compatibleDataNamespaces.map((name) => join(input.appDataPath, name)),
      ]),
    ].filter((candidate) => candidate === undefined || input.exists(candidate)),
    fallbackDaemonStateHome: input.environmentStateHome,
  }
}

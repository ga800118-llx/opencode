import { describe, expect, test } from "bun:test"
import { getProductIdentity, getRuntimeProductIdentity } from "./identity"

describe("desktop product identity", () => {
  test("uses the Guai Code development identity without moving existing development data", () => {
    expect(getProductIdentity("dev")).toMatchObject({
      name: "Guai Code Dev",
      appId: "dev.agent.desktop",
      protocolScheme: "guai-code-dev",
      dataNamespace: "dev.agent.desktop",
      credentialNamespace: "dev.agent.desktop.credentials",
      artifactPrefix: "guai-code-desktop-dev",
      linuxPackageName: "guai-code-dev",
      compatibleDataNamespaces: ["dev.agent.desktop"],
    })
  })

  test("keeps development identifiers separate from OpenCode releases", () => {
    const development = getProductIdentity("dev")
    const releases = [getProductIdentity("beta"), getProductIdentity("prod")]
    const releaseIdentifiers = new Set(
      releases.flatMap((identity) => [
        identity.name,
        identity.appId,
        identity.protocolScheme,
        identity.dataNamespace,
        identity.credentialNamespace,
        identity.artifactPrefix,
        identity.linuxPackageName,
      ]),
    )

    for (const identifier of [
      development.name,
      development.appId,
      development.protocolScheme,
      development.dataNamespace,
      development.credentialNamespace,
      development.artifactPrefix,
      development.linuxPackageName,
    ]) {
      expect(releaseIdentifiers.has(identifier)).toBe(false)
    }
    expect(development.compatibleDataNamespaces.some((namespace) => namespace.startsWith("ai.opencode.desktop"))).toBe(
      false,
    )
  })

  test("uses Guai Code-owned beta and production identities without upstream publishing", () => {
    expect(getProductIdentity("beta")).toMatchObject({
      name: "Guai Code Beta",
      appId: "com.guaicode.desktop.beta",
      protocolScheme: "guai-code-beta",
      artifactPrefix: "guai-code-desktop-beta",
      linuxPackageName: "guai-code-beta",
      compatibleDataNamespaces: [],
      publish: undefined,
    })
    expect(getProductIdentity("prod")).toMatchObject({
      name: "Guai Code",
      appId: "com.guaicode.desktop",
      protocolScheme: "guai-code",
      artifactPrefix: "guai-code-desktop",
      linuxPackageName: "guai-code",
      compatibleDataNamespaces: ["com.guaicode.desktop.beta", "dev.agent.desktop"],
      publish: undefined,
    })
  })

  test("uses development identity for unpackaged runtime", () => {
    expect(getRuntimeProductIdentity("beta", false)).toBe(getProductIdentity("dev"))
    expect(getRuntimeProductIdentity("beta", true)).toBe(getProductIdentity("beta"))
  })

  test("deeply freezes identities without sharing release namespace arrays", () => {
    const development = getProductIdentity("dev")
    const beta = getProductIdentity("beta")
    const prod = getProductIdentity("prod")
    const mutableDevelopment = development as unknown as { name: string }
    const mutableBeta = beta as unknown as { compatibleDataNamespaces: string[] }

    for (const identity of [development, beta, prod]) {
      expect(Object.isFrozen(identity)).toBe(true)
      expect(Object.isFrozen(identity.compatibleDataNamespaces)).toBe(true)
      if (identity.publish) expect(Object.isFrozen(identity.publish)).toBe(true)
    }
    expect(beta.compatibleDataNamespaces).not.toBe(prod.compatibleDataNamespaces)
    expect(() => {
      mutableDevelopment.name = "polluted"
    }).toThrow()
    expect(() => mutableBeta.compatibleDataNamespaces.push("polluted")).toThrow()
    expect(getProductIdentity("dev").name).toBe("Guai Code Dev")
    expect(getProductIdentity("beta").publish).toBeUndefined()
    expect(getProductIdentity("prod").compatibleDataNamespaces).not.toContain("polluted")
  })
})

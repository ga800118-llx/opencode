import { describe, expect, test } from "bun:test"
import { getProductIdentity, getRuntimeProductIdentity } from "./identity"

describe("desktop product identity", () => {
  test("uses the neutral development identity", () => {
    expect(getProductIdentity("dev")).toMatchObject({
      name: "Agent Desktop Dev",
      appId: "dev.agent.desktop",
      protocolScheme: "agent-desktop-dev",
      dataNamespace: "dev.agent.desktop",
      credentialNamespace: "dev.agent.desktop.credentials",
      artifactPrefix: "agent-desktop-dev",
      linuxPackageName: "agent-desktop-dev",
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

  test("preserves beta and production release identities", () => {
    expect(getProductIdentity("beta")).toMatchObject({
      name: "Agent Desktop Beta",
      appId: "ai.opencode.desktop.beta",
      protocolScheme: "opencode",
      artifactPrefix: "opencode-desktop",
      linuxPackageName: "opencode-beta",
      publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
    })
    expect(getProductIdentity("prod")).toMatchObject({
      name: "Agent Desktop",
      appId: "ai.opencode.desktop",
      protocolScheme: "opencode",
      artifactPrefix: "opencode-desktop",
      linuxPackageName: "opencode",
      publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
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
    const mutableBeta = beta as unknown as {
      publish: { repo: string }
      compatibleDataNamespaces: string[]
    }

    for (const identity of [development, beta, prod]) {
      expect(Object.isFrozen(identity)).toBe(true)
      expect(Object.isFrozen(identity.compatibleDataNamespaces)).toBe(true)
      if (identity.publish) expect(Object.isFrozen(identity.publish)).toBe(true)
    }
    expect(beta.compatibleDataNamespaces).not.toBe(prod.compatibleDataNamespaces)
    expect(() => {
      mutableDevelopment.name = "polluted"
    }).toThrow()
    expect(() => {
      mutableBeta.publish.repo = "polluted"
    }).toThrow()
    expect(() => mutableBeta.compatibleDataNamespaces.push("polluted")).toThrow()
    expect(getProductIdentity("dev").name).toBe("Agent Desktop Dev")
    expect(getProductIdentity("beta").publish?.repo).toBe("opencode-beta")
    expect(getProductIdentity("prod").compatibleDataNamespaces).not.toContain("polluted")
  })
})

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
      ]),
    )

    for (const identifier of [
      development.name,
      development.appId,
      development.protocolScheme,
      development.dataNamespace,
      development.credentialNamespace,
      development.artifactPrefix,
    ]) {
      expect(releaseIdentifiers.has(identifier)).toBe(false)
    }
    expect(development.compatibleDataNamespaces.some((namespace) => namespace.startsWith("ai.opencode.desktop"))).toBe(
      false,
    )
  })

  test("preserves beta and production release identities", () => {
    expect(getProductIdentity("beta")).toMatchObject({
      name: "OpenCode Beta",
      appId: "ai.opencode.desktop.beta",
      protocolScheme: "opencode",
      artifactPrefix: "opencode-desktop",
      publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
    })
    expect(getProductIdentity("prod")).toMatchObject({
      name: "OpenCode",
      appId: "ai.opencode.desktop",
      protocolScheme: "opencode",
      artifactPrefix: "opencode-desktop",
      publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
    })
  })

  test("uses development identity for unpackaged runtime", () => {
    expect(getRuntimeProductIdentity("beta", false)).toBe(getProductIdentity("dev"))
    expect(getRuntimeProductIdentity("beta", true)).toBe(getProductIdentity("beta"))
  })
})

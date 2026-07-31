export type ProductChannel = "dev" | "beta" | "prod"

type ProductPublish = {
  provider: "github"
  owner: string
  repo: string
  channel: "latest"
}

export type ProductIdentity = {
  channel: ProductChannel
  name: string
  appId: string
  protocolScheme: string
  dataNamespace: string
  credentialNamespace: string
  artifactPrefix: string
  linuxPackageName: string
  compatibleDataNamespaces: readonly string[]
  publish?: ProductPublish
}

type ProductIdentityInput = Omit<ProductIdentity, "dataNamespace" | "credentialNamespace">

const openCodeDataNamespaces = ["ai.opencode.desktop.dev", "ai.opencode.desktop.beta", "ai.opencode.desktop"]

const identities: Record<ProductChannel, ProductIdentity> = {
  dev: defineProductIdentity({
    channel: "dev",
    name: "Agent Desktop Dev",
    appId: "dev.agent.desktop",
    protocolScheme: "agent-desktop-dev",
    artifactPrefix: "agent-desktop-dev",
    linuxPackageName: "agent-desktop-dev",
    compatibleDataNamespaces: ["dev.agent.desktop"],
  }),
  beta: defineProductIdentity({
    channel: "beta",
    name: "OpenCode Beta",
    appId: "ai.opencode.desktop.beta",
    protocolScheme: "opencode",
    artifactPrefix: "opencode-desktop",
    linuxPackageName: "opencode-beta",
    compatibleDataNamespaces: openCodeDataNamespaces,
    publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
  }),
  prod: defineProductIdentity({
    channel: "prod",
    name: "OpenCode",
    appId: "ai.opencode.desktop",
    protocolScheme: "opencode",
    artifactPrefix: "opencode-desktop",
    linuxPackageName: "opencode",
    compatibleDataNamespaces: openCodeDataNamespaces,
    publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
  }),
}

export function getProductIdentity(channel: ProductChannel) {
  return identities[channel]
}

export function getRuntimeProductIdentity(channel: ProductChannel, packaged: boolean) {
  return getProductIdentity(packaged ? channel : "dev")
}

function defineProductIdentity(input: ProductIdentityInput): ProductIdentity {
  return {
    ...input,
    dataNamespace: input.appId,
    credentialNamespace: `${input.appId}.credentials`,
  }
}

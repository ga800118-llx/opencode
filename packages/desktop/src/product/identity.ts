export type ProductChannel = "dev" | "beta" | "prod"

export type ProductPublish = {
  readonly provider: "github"
  readonly owner: string
  readonly repo: string
  readonly channel: "latest"
}

export type ProductIdentity = {
  readonly channel: ProductChannel
  readonly name: string
  readonly appId: string
  readonly protocolScheme: string
  readonly dataNamespace: string
  readonly credentialNamespace: string
  readonly artifactPrefix: string
  readonly linuxPackageName: string
  readonly compatibleDataNamespaces: readonly string[]
  readonly publish?: ProductPublish
}

type ProductIdentityInput = Omit<ProductIdentity, "dataNamespace" | "credentialNamespace">

const openCodeDataNamespaces = Object.freeze([
  "ai.opencode.desktop.dev",
  "ai.opencode.desktop.beta",
  "ai.opencode.desktop",
])

const identities = Object.freeze({
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
}) satisfies Readonly<Record<ProductChannel, ProductIdentity>>

export function getProductIdentity(channel: ProductChannel) {
  return identities[channel]
}

export function getRuntimeProductIdentity(channel: ProductChannel, packaged: boolean) {
  return getProductIdentity(packaged ? channel : "dev")
}

function defineProductIdentity(input: ProductIdentityInput): ProductIdentity {
  return Object.freeze({
    ...input,
    dataNamespace: input.appId,
    credentialNamespace: `${input.appId}.credentials`,
    compatibleDataNamespaces: Object.freeze([...input.compatibleDataNamespaces]),
    publish: input.publish ? Object.freeze({ ...input.publish }) : undefined,
  })
}

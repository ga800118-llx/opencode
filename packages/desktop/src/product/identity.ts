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

const identities = Object.freeze({
  dev: defineProductIdentity({
    channel: "dev",
    name: "Guai Code Dev",
    appId: "dev.agent.desktop",
    protocolScheme: "guai-code-dev",
    artifactPrefix: "guai-code-desktop-dev",
    linuxPackageName: "guai-code-dev",
    compatibleDataNamespaces: ["dev.agent.desktop"],
  }),
  beta: defineProductIdentity({
    channel: "beta",
    name: "Guai Code Beta",
    appId: "com.guaicode.desktop.beta",
    protocolScheme: "guai-code-beta",
    artifactPrefix: "guai-code-desktop-beta",
    linuxPackageName: "guai-code-beta",
    compatibleDataNamespaces: [],
  }),
  prod: defineProductIdentity({
    channel: "prod",
    name: "Guai Code",
    appId: "com.guaicode.desktop",
    protocolScheme: "guai-code",
    artifactPrefix: "guai-code-desktop",
    linuxPackageName: "guai-code",
    compatibleDataNamespaces: ["com.guaicode.desktop.beta", "dev.agent.desktop"],
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

import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const channels = [
  {
    channel: "dev",
    appId: "dev.agent.desktop",
    productName: "Guai Code Dev",
    protocolScheme: "guai-code-dev",
    artifactPrefix: "guai-code-desktop-dev",
    linuxPackageName: "guai-code-dev",
    macIdentity: undefined,
    notarize: false,
  },
  {
    channel: "beta",
    appId: "com.guaicode.desktop.beta",
    productName: "Guai Code Beta",
    protocolScheme: "guai-code-beta",
    artifactPrefix: "guai-code-desktop-beta",
    linuxPackageName: "guai-code-beta",
    macIdentity: "-",
    notarize: false,
  },
  {
    channel: "prod",
    appId: "com.guaicode.desktop",
    productName: "Guai Code",
    protocolScheme: "guai-code",
    artifactPrefix: "guai-code-desktop",
    linuxPackageName: "guai-code",
    macIdentity: undefined,
    notarize: true,
  },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toBe(channel.productName)
    expect(config.protocols).toEqual({ name: channel.productName, schemes: [channel.protocolScheme] })
    expect(config.artifactName).toBe(channel.artifactPrefix + "-${version}-${os}-${arch}.${ext}")
    expect(config.publish).toBeUndefined()
    expect(config.mac?.identity).toBe(channel.macIdentity)
    expect(config.mac?.notarize).toBe(channel.notarize)
    expect(config.deb?.packageName).toBe(channel.linuxPackageName)
    expect(config.rpm?.packageName).toBe(channel.linuxPackageName)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

test("bundles the CLI outside the dev app archive", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "dev"
  const module = await import("./electron-builder.config.ts?cli-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(config.files).toContain("!resources/opencode-cli*")
  expect(config.extraResources).toContainEqual({
    from: "resources/",
    to: "",
    filter: ["opencode-cli*"],
  })
})

test("bundles runtime icons outside the app archive", async () => {
  const module = await import("./electron-builder.config.ts?runtime-icons")
  const config = module.default as Configuration

  expect(config.extraResources).toContainEqual({
    from: "resources/icons/",
    to: "icons/",
    filter: ["**/*"],
  })
  expect(config.extraResources).toContainEqual({
    from: "../../LICENSE",
    to: "licenses/OpenCode-MIT.txt",
  })
})

test("bundles MinGit from a nonempty environment path", async () => {
  const previous = process.env.GUAI_CODE_BUNDLED_GIT_DIR
  process.env.GUAI_CODE_BUNDLED_GIT_DIR = "C:\\staging\\mingit"
  const module = await import("./electron-builder.config.ts?bundled-git-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.GUAI_CODE_BUNDLED_GIT_DIR
  if (previous !== undefined) process.env.GUAI_CODE_BUNDLED_GIT_DIR = previous

  expect(config.extraResources).toContainEqual({
    from: "C:\\staging\\mingit",
    to: "mingit",
    filter: ["**/*"],
  })
})

test("does not bundle MinGit from an empty environment path", async () => {
  const previous = process.env.GUAI_CODE_BUNDLED_GIT_DIR
  process.env.GUAI_CODE_BUNDLED_GIT_DIR = "   "
  const module = await import("./electron-builder.config.ts?no-bundled-git-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.GUAI_CODE_BUNDLED_GIT_DIR
  if (previous !== undefined) process.env.GUAI_CODE_BUNDLED_GIT_DIR = previous

  expect(config.extraResources).not.toContainEqual({
    from: expect.any(String),
    to: "mingit",
    filter: ["**/*"],
  })
})

test("bundles ripgrep from a nonempty environment path", async () => {
  const previous = process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR
  process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR = "C:\\staging\\ripgrep"
  const module = await import("./electron-builder.config.ts?bundled-ripgrep-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR
  if (previous !== undefined) process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR = previous

  expect(config.extraResources).toContainEqual({
    from: "C:\\staging\\ripgrep",
    to: "ripgrep",
    filter: ["**/*"],
  })
})

test("does not bundle ripgrep from an empty environment path", async () => {
  const previous = process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR
  process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR = "   "
  const module = await import("./electron-builder.config.ts?no-bundled-ripgrep-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR
  if (previous !== undefined) process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR = previous

  expect(config.extraResources).not.toContainEqual({
    from: expect.any(String),
    to: "ripgrep",
    filter: ["**/*"],
  })
})

test("uses a one-click unelevated per-user Windows installer", async () => {
  const module = await import("./electron-builder.config.ts?windows-installer")
  const config = module.default as Configuration

  expect(config.nsis).toMatchObject({
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    runAfterFinish: false,
  })
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?no-cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    })
  })
}

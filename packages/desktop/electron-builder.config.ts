import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"
import { getProductIdentity, type ProductIdentity } from "./src/product/identity"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const bundledGitDir = process.env.GUAI_CODE_BUNDLED_GIT_DIR?.trim()
const bundledRipgrepDir = process.env.GUAI_CODE_BUNDLED_RIPGREP_DIR?.trim()

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const getBase = (identity: ProductIdentity): Configuration => ({
  appId: identity.appId,
  productName: identity.name,
  artifactName: identity.artifactPrefix + "-${version}-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. The suffix is required even when the app id contains dots.
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${identity.appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    {
      from: "resources/icons/",
      to: "icons/",
      filter: ["**/*"],
    },
    {
      from: "../../LICENSE",
      to: "licenses/OpenCode-MIT.txt",
    },
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
    ...(bundledGitDir
      ? [
          {
            from: bundledGitDir,
            to: "mingit",
            filter: ["**/*"],
          },
        ]
      : []),
    ...(bundledRipgrepDir
      ? [
          {
            from: bundledRipgrepDir,
            to: "ripgrep",
            filter: ["**/*"],
          },
        ]
      : []),
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    identity: channel === "beta" ? "-" : undefined,
    notarize: channel === "prod",
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: identity.name,
    schemes: [identity.protocolScheme],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    runAfterFinish: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: identity.appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: identity.appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const identity = getProductIdentity(channel)
  const base = getBase(identity)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        deb: { packageName: identity.linuxPackageName, fpm: [metainfoFpm(identity.appId)] },
        rpm: { packageName: identity.linuxPackageName, fpm: [metainfoFpm(identity.appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        deb: { packageName: identity.linuxPackageName, fpm: [metainfoFpm(identity.appId)] },
        rpm: { packageName: identity.linuxPackageName, fpm: [metainfoFpm(identity.appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        deb: { packageName: identity.linuxPackageName, fpm: [metainfoFpm(identity.appId)] },
        rpm: { packageName: identity.linuxPackageName, fpm: [metainfoFpm(identity.appId)] },
      }
    }
  }
}

export default getConfig()

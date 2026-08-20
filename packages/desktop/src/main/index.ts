import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, dialog, safeStorage } from "electron"

import { Deferred, Effect, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { createBundledGitEnvironment } from "../product/bundled-git"
import { normalizeProductDeepLinks } from "../product/deep-link"
import {
  createUnavailableSidecarStatus,
  sanitizeProductSidecarStatus,
  type ProductSidecarStatus,
} from "../product/host"
import { getRuntimeProductIdentity } from "../product/identity"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { forwardInitializationFailure } from "./initialization"
import { exportDebugLogs, initCrashReporter, initLogging, startNetLog, write as writeLog } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { createContextMenuLabels } from "./context-menu-labels"
import { createContextMenuInstaller } from "./context-menu-installer"
import { createContextMenuOptions } from "./context-menu-options"
import { createNativeUiController } from "./native-ui-controller"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import { getDefaultServerUrl, preferAppEnv, setDefaultServerUrl, spawnLocalServer } from "./server"
import { createSidecarSupervisor, type SidecarSupervisor } from "./sidecar-supervisor"
import { waitForSidecarReadiness } from "./sidecar-readiness"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  createStartupShutdownGuard,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
  setQuerySessionEndHandler,
  setSessionEndHandler,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"
import { startBackgroundCli } from "./background-cli"
import type { BackgroundCliController } from "./background-cli-lifecycle"
import { createBackgroundCliOwnership } from "./background-cli-ownership"
import { createQuitCoordinator } from "./quit-coordinator"
import { createCredentialService } from "./model-center/credentials"
import { createSensitiveHeaderCredentialProxy } from "./model-center/credential-proxy"
import { createModelCredentialEnvironment } from "./model-center/environment"
import { createLocalModelDetector } from "./model-center/local-detection"
import { createModelProbe } from "./model-center/probe"
import { createProfileRepository } from "./model-center/profiles"
import { createProductRuntimeConfigCoordinator, initializeProductRuntimeConfig } from "./model-center/runtime-config"
import { createModelCenterService } from "./model-center/service"
import {
  createDesktopRuntimeEnvironment,
  createDesktopRuntimePaths,
  ensureDesktopRuntime,
  installDesktopRuntimeEnvironment,
} from "./runtime-environment"
import { getStore } from "./store"
import { MODEL_CREDENTIALS_STORE, MODEL_PROFILES_STORE } from "./store-keys"
import { resolveDesktopUserDataPath } from "./user-data"
import { configureCACertificates } from "./ca-certificates"
import { mountedApplicationMessage, shouldBlockMountedApplication } from "./install-location"

const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const SIDECAR_VERSION = process.env.OPENCODE_SIDECAR_V2 === "1" ? "v2" : "v1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

let logger: ReturnType<typeof initLogging>
let server: SidecarSupervisor | null = null
const backgroundCli = createBackgroundCliOwnership<BackgroundCliController>()
let startupShutdownGuard: ReturnType<typeof createStartupShutdownGuard> | undefined
let productSidecarStatus = createUnavailableSidecarStatus()
let detachProductSidecarStatus: (() => void) | undefined
const productSidecarSubscribers = new Set<(status: ProductSidecarStatus) => void>()

const pendingDeepLinks: string[] = []

function disposeStartupShutdownGuard() {
  startupShutdownGuard?.dispose()
  startupShutdownGuard = undefined
}

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function killSidecar() {
  const current = server
  server = null
  if (current) await current.stop()
  if (!backgroundCli.hasStartup()) return

  const startedAt = productSidecarStatus.startedAt
  publishV2SidecarStatus("stopping", startedAt === undefined ? {} : { startedAt })
  const stopped = await backgroundCli.stop().catch((error) => {
    publishV2SidecarStatus("failed", {
      ...(startedAt === undefined ? {} : { startedAt }),
      error: { kind: "exit" },
    })
    throw error
  })
  if (stopped) publishV2SidecarStatus("stopped", { stoppedAt: Date.now() })
}

function publishProductSidecarStatus(status: ProductSidecarStatus) {
  productSidecarStatus = sanitizeProductSidecarStatus(status)
  for (const subscriber of productSidecarSubscribers) {
    try {
      subscriber(productSidecarStatus)
    } catch {
      logger?.warn("product sidecar status subscriber failed")
    }
  }
}

function publishV2SidecarStatus(state: ProductSidecarStatus["state"], fields: Record<string, unknown> = {}) {
  publishProductSidecarStatus(sanitizeProductSidecarStatus({ state, attempt: 0, changedAt: Date.now(), ...fields }))
}

function subscribeProductSidecarStatus(subscriber: (status: ProductSidecarStatus) => void) {
  productSidecarSubscribers.add(subscriber)
  try {
    subscriber(productSidecarStatus)
  } catch {
    logger?.warn("product sidecar status subscriber failed")
  }
  return () => productSidecarSubscribers.delete(subscriber)
}

async function restartProductSidecar() {
  const current = server
  if (current) {
    await current.restart()
    return productSidecarStatus
  }

  const background = backgroundCli.current()
  if (!background) return productSidecarStatus
  const startedAt = productSidecarStatus.startedAt
  publishV2SidecarStatus("restarting", startedAt === undefined ? {} : { startedAt })
  return background.restart().then(
    () => {
      const readyAt = Date.now()
      publishV2SidecarStatus("ready", { startedAt: startedAt ?? readyAt, readyAt })
      return productSidecarStatus
    },
    (error) => {
      publishV2SidecarStatus("failed", {
        ...(startedAt === undefined ? {} : { startedAt }),
        error: { kind: "start" },
      })
      throw error
    },
  )
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  const identity = getRuntimeProductIdentity(CHANNEL, app.isPackaged)

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(identity.name)
  app.setAppUserModelId(identity.appId)
  app.setPath(
    "userData",
    resolveDesktopUserDataPath({
      appDataPath: app.getPath("appData"),
      dataNamespace: identity.dataNamespace,
      commandLineOverride: app.commandLine.getSwitchValue("user-data-dir"),
      onboardingRoot: onboardingTestRoot,
    }),
  )
  const runtimePaths = createDesktopRuntimePaths(app.getPath("userData"))
  installDesktopRuntimeEnvironment(runtimePaths)
  yield* Effect.promise(() => ensureDesktopRuntime(runtimePaths))
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  let stopModelCredentialProxy: () => Promise<void> = async () => undefined
  let nativeUi: ReturnType<typeof createNativeUiController> | undefined
  const stopSidecars = async () => {
    disposeStartupShutdownGuard()
    try {
      nativeUi?.dispose()
    } catch (error) {
      logger.warn("failed to dispose native UI", error)
    }
    await killSidecar()
    await stopModelCredentialProxy()
    wslServers.stopAll()
  }
  const quitCoordinator = createQuitCoordinator({
    markQuitting: setAppQuitting,
    cleanup: stopSidecars,
    quit: () => app.quit(),
    onCleanupError: (error) => logger.warn("sidecar shutdown failed", error),
  })
  setQuerySessionEndHandler(quitCoordinator.querySessionEnd)
  setSessionEndHandler(quitCoordinator.sessionEnd)
  const relaunch = () => {
    setAppQuitting()
    void quitCoordinator.cleanup().finally(() => {
      app.relaunch()
      app.exit(0)
    })
  }

  try {
    configureCACertificates({
      environment: process.env,
      get: getCACertificates,
      set: setDefaultCACertificates,
    })
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv()
  const bundledGit = createBundledGitEnvironment({
    platform: process.platform,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    inheritedPath: process.env.PATH,
    exists: existsSync,
  })
  if (bundledGit) {
    process.env.PATH = bundledGit.path
    if ("gitExecPath" in bundledGit) process.env.GIT_EXEC_PATH = bundledGit.gitExecPath
    if ("gitConfigSystem" in bundledGit) process.env.GIT_CONFIG_SYSTEM = bundledGit.gitConfigSystem
    if ("gitTemplateDir" in bundledGit) process.env.GIT_TEMPLATE_DIR = bundledGit.gitTemplateDir
    logger.log("bundled git enabled", { directory: bundledGit.directory })
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = normalizeProductDeepLinks(identity, argv)
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    const urls = normalizeProductDeepLinks(identity, [url])
    if (urls.length) {
      logger.log("deep link received via open-url", { urls })
      emitDeepLinks(urls)
    }
  })

  app.on("before-quit", quitCoordinator.beforeQuit)

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void quitCoordinator.cleanup().finally(() => app.exit(0))
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())
  if (
    shouldBlockMountedApplication({
      platform: process.platform,
      packaged: app.isPackaged,
      execPath: process.execPath,
    })
  ) {
    yield* Effect.promise(() =>
      dialog.showMessageBox({
        type: "warning",
        title: identity.name,
        message: mountedApplicationMessage(identity.name),
      }),
    )
    app.quit()
    return
  }
  startupShutdownGuard = createStartupShutdownGuard()

  if (!TEST_ONBOARDING) migrate()
  const credentialStore = getStore(MODEL_CREDENTIALS_STORE)
  const credentialService = createCredentialService({
    namespace: identity.credentialNamespace,
    platform: process.platform,
    safeStorage,
    store: {
      get: (key) => credentialStore.get(key),
      set: (key, value) => credentialStore.set(key, value),
      delete: (key) => credentialStore.delete(key),
    },
  })
  const profileStore = getStore(MODEL_PROFILES_STORE)
  const profileRepository = createProfileRepository({
    store: {
      get: (key) => profileStore.get(key),
      set: (key, value) => profileStore.set(key, value),
    },
  })
  const credentialProxy = createSensitiveHeaderCredentialProxy({
    profiles: profileRepository,
    credentials: credentialService,
    store: {
      get: (key) => profileStore.get(key),
      set: (key, value) => profileStore.set(key, value),
    },
    warn: (message, meta) => logger.warn(message, meta),
  })
  yield* Effect.promise(() => credentialProxy.start())
  stopModelCredentialProxy = credentialProxy.stop
  const runtimeConfigCoordinator = createProductRuntimeConfigCoordinator({
    paths: runtimePaths,
    profiles: profileRepository.list,
    defaultSelection: profileRepository.defaultSelection,
    presentProfile: credentialProxy.presentProfile,
  })
  const logProductRuntimeConfig = (result: Awaited<ReturnType<typeof runtimeConfigCoordinator.write>>) => {
    logger.log("model runtime config refreshed", {
      modelConfig: runtimePaths.modelConfig,
      manifest: runtimePaths.manifest,
      migrationMarker: runtimePaths.migrationMarker,
      profiles: result.profileCount,
      providers: result.providerCount,
      models: result.modelCount,
    })
  }
  const initialRuntimeConfig = yield* Effect.promise(() =>
    initializeProductRuntimeConfig({
      write: runtimeConfigCoordinator.write,
      cleanup: quitCoordinator.cleanup,
      terminate: () => {
        setAppQuitting()
        app.exit(1)
      },
    }),
  )
  logProductRuntimeConfig(initialRuntimeConfig)
  const createLocalSidecarEnvironment = () =>
    createDesktopRuntimeEnvironment(runtimePaths, {
      ...process.env,
      ...createModelCredentialEnvironment({
        profiles: profileRepository.list(),
        credentials: credentialService,
        credentialProxy: credentialProxy.runtimeEnvironment,
        warn: (warning) => logger.warn("model credential unavailable", warning),
      }),
    })
  const modelProbe = createModelProbe()
  const modelDetector = createLocalModelDetector({ discover: modelProbe.discover })
  const modelCenter = createModelCenterService({
    profiles: profileRepository,
    credentials: credentialService,
    probe: modelProbe,
    detector: modelDetector,
    presentProfile: credentialProxy.presentProfile,
    reloadCredentials: async () => {
      await runtimeConfigCoordinator.reload(async (result) => {
        logProductRuntimeConfig(result)
        await restartProductSidecar()
      })
    },
  })
  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient(identity.protocolScheme)
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(quitCoordinator.cleanup)
  const installContextMenu = createContextMenuInstaller({
    createLabels: createContextMenuLabels,
    register: (labels) => contextMenu(createContextMenuOptions(labels)),
  })
  const nativeUiController = createNativeUiController({
    initialLocale: app.getLocale(),
    installApplicationMenu: (locale) =>
      createMenu({
        locale,
        appName: identity.name,
        trigger: (id) => {
          const win = getLastFocusedWindow()
          if (win) sendMenuCommand(win, id)
        },
        checkForUpdates: () => {
          void showUpdaterDialog(updater, true)
        },
        relaunch,
      }),
    installContextMenu,
  })
  nativeUi = nativeUiController
  nativeUiController.start()
  registerIpcHandlers({
    getProductSidecarStatus: () => productSidecarStatus,
    subscribeProductSidecarStatus,
    restartProductSidecar,
    getProductCredentialCapabilities: () => credentialService.capabilities(),
    modelCenter,
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    setApplicationLocale: (locale) => nativeUiController.setLocale(locale),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
  })
  registerWslIpcHandlers(wslServers)
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { version: SIDECAR_VERSION })

    ensureLoopbackNoProxy()
    useEnvProxy()

    if (SIDECAR_VERSION === "v2") {
      logger.log("starting desktop-managed v2 sidecar", { managed: true })
      const startedAt = Date.now()
      publishV2SidecarStatus("starting", { startedAt })
      const startup = backgroundCli.start(() =>
        startBackgroundCli(logger, {
          environment: createLocalSidecarEnvironment,
          runtimeStateHome: runtimePaths.state,
        }),
      )
      const sidecar = yield* Effect.promise(() =>
        startup.catch((error) => {
          publishV2SidecarStatus("failed", { startedAt, error: { kind: "start" } })
          throw error
        }),
      )
      yield* Effect.promise(() =>
        waitForSidecarReadiness(sidecar.url, sidecar.password, { directory: runtimePaths.root }),
      )
      logger.log("sidecar provider readiness passed")
      const readyAt = Date.now()
      publishV2SidecarStatus("ready", { startedAt, readyAt })
      yield* Deferred.succeed(serverReady, {
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })

      if (process.platform === "win32") {
        void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
      }

      logger.log("loading task finished")
      return
    }

    const port = yield* Effect.gen(function* () {
      const fromEnv = process.env.OPENCODE_PORT
      if (fromEnv) {
        const parsed = Number.parseInt(fromEnv, 10)
        if (!Number.isNaN(parsed)) return parsed
      }

      const res = yield* Deferred.make<number, unknown>()
      const socket = createServer()
      socket.on("error", (e) => Deferred.failSync(res, () => e))
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address()
        if (typeof address !== "object" || !address) {
          socket.close()
          Deferred.failSync(res, () => new Error("Failed to get port"))
          return
        }
        const port = address.port
        socket.close(() => Effect.runSync(Deferred.succeed(res, port)))
      })

      return yield* Deferred.await(res)
    })
    const hostname = "127.0.0.1"
    const url = `http://${hostname}:${port}`
    const username = "opencode"
    const password = randomUUID()

    logger.log("creating supervised sidecar", { url })
    const supervisor = createSidecarSupervisor({
      spawn: async () => {
        logger.log("spawning supervised sidecar", { url })
        const instance = await spawnLocalServer(hostname, port, password, {
          environment: createLocalSidecarEnvironment(),
          onStdout: (message) => writeLog("server", "stdout", { message }),
          onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
          onExit: (code) => writeLog("utility", "sidecar exited", { code }, "warn"),
        })
        const health = withTimeout(instance.health.wait, 30_000, "Sidecar health check timed out.")
        return {
          listener: instance.listener,
          health: {
            wait: health,
          },
          readiness: {
            wait: health.then(async () => {
              await waitForSidecarReadiness(url, password, { directory: runtimePaths.root })
              logger.log("sidecar provider readiness passed")
            }),
          },
        }
      },
      logger: {
        log: (message, meta) => logger.log(message, meta),
        warn: (message, meta) => logger.warn(message, meta),
      },
    })
    server = supervisor
    detachProductSidecarStatus?.()
    detachProductSidecarStatus = supervisor.subscribe((status) =>
      publishProductSidecarStatus(sanitizeProductSidecarStatus(status)),
    )
    yield* Effect.promise(() => supervisor.start())
    yield* Deferred.succeed(serverReady, {
      url,
      username,
      password,
    })

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)

  const windows = startupShutdownGuard?.handoff(restoreMainWindows) ?? []
  startupShutdownGuard = undefined
  if (windows.length) nativeUiController.enableApplicationMenu()
})

Effect.runFork(main.pipe(Effect.ensuring(Effect.sync(disposeStartupShutdownGuard))))

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

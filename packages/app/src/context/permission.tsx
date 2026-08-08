import { createEffect, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import type { Permission } from "@opencode-ai/schema/permission"
import { Persist, persisted } from "@/utils/persist"
import type { ServerSDK } from "@/context/server-sdk"
import type { ServerSync } from "./server-sync"
import { useParams, useSearchParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { type DraftTab, useTabs } from "./tabs"
import { useSettings } from "./settings"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"
import { normalizePermissionRequest } from "./global-sync/utils"
import {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
  lineagePermissionMode,
  modeAutoRespondsPermission,
  normalizeAcceptKeys,
  sessionAutoAccept,
} from "./permission-auto-respond"
import {
  migratePermissionModes,
  normalizePermissionMode,
  normalizePermissionModes,
  projectPermissionMode,
  taskPermissionMode,
} from "./permission-mode"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

type PermissionModeSessionApi = {
  switchPermissionMode(input: { sessionID: string; mode: Permission.Mode }): Promise<unknown>
}

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isPermissionRequest(value: unknown): value is PermissionRequest {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionID === "string" &&
    typeof value.permission === "string" &&
    Array.isArray(value.patterns) &&
    isRecord(value.metadata) &&
    Array.isArray(value.always)
  )
}

function isPermissionModeSwitched(value: unknown): value is { sessionID: string; mode: Permission.Mode } {
  return isRecord(value) && typeof value.sessionID === "string" && normalizePermissionMode(value.mode) !== undefined
}

function normalizeBooleanRecord(value: unknown, directoryOnly = false) {
  if (!isRecord(value)) return {} as Record<string, boolean>
  return normalizeAcceptKeys(
    Object.fromEntries(
      Object.entries(value).flatMap(([key, enabled]) => {
        if (typeof enabled !== "boolean") return []
        if (directoryOnly && !key.endsWith("/*")) return []
        return [[key, enabled]]
      }),
    ),
  )
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const [search] = useSearchParams<{ draftId?: string }>()
    const global = useGlobal()
    const server = useServer()
    const tabs = useTabs()
    const settings = useSettings()
    const owner = getOwner()
    const states = new Map<ServerScope, { key: ServerConnection.Key; dispose: () => void; state: PermissionState }>()

    const activeDraft = createMemo(() => {
      if (!search.draftId) return
      return tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
    })

    const activeServer = createMemo(() => {
      if (params.serverKey && settings.general.newLayoutDesigns()) return requireServerKey(params.serverKey)
      return activeDraft()?.server ?? server.key
    })

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Permission server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing && global.servers.list().some((item) => ServerConnection.key(item) === existing.key)) {
        return existing.state
      }
      if (existing) {
        existing.dispose()
        states.delete(ctx.sdk.scope)
      }
      const root = createRoot(
        (dispose) => ({
          key,
          dispose,
          state: createServerPermissionState({ sdk: ctx.sdk, sync: ctx.sync }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const list = global.servers.list()
      const keys = new Set(list.map(ServerConnection.key))
      states.forEach((value, scope) => {
        if (keys.has(value.key)) return
        value.dispose()
        states.delete(scope)
        const replacement = list.find((conn) => server.scope(ServerConnection.key(conn)) === scope)
        if (replacement) ensure(ServerConnection.key(replacement))
      })
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    let lastSelected: PermissionState | undefined
    const selected = () => {
      const key = activeServer()
      if (global.servers.list().some((conn) => ServerConnection.key(conn) === key)) {
        lastSelected = ensure(key)
      }
      if (lastSelected) return lastSelected
      return ensure(server.key)
    }
    const activeDirectory = createMemo(() => {
      const directory = decode64(params.dir)
      if (directory) return directory
      const draft = activeDraft()
      if (draft) return draft.directory
      if (!params.id) return
      if (!global.servers.list().some((conn) => ServerConnection.key(conn) === activeServer())) return
      return selected().sync.session.lineage.peek(params.id)?.session.directory
    })

    createEffect(() => {
      const directory = activeDirectory()
      if (!directory) return
      selected().enableConfiguredDirectory(directory)
    })

    const permissionsEnabled = createMemo(() => {
      const directory = activeDirectory()
      if (!directory) return false
      return selected().permissionsEnabled(directory)
    })

    return {
      ready: () => selected().ready(),
      ensureServerState: (key: ServerConnection.Key) => ensure(key).api,
      currentServerState: () => selected().api,
      respond(input: Parameters<PermissionRespondFn>[0]) {
        selected().respond(input)
      },
      projectMode(directory: string) {
        return selected().projectMode(directory)
      },
      mode(sessionID: string | undefined, directory: string) {
        return selected().mode(sessionID, directory)
      },
      setMode(input: { sessionID?: string; directory: string; mode: Permission.Mode }) {
        return selected().setMode(input)
      },
      autoConfirmed(directory: string) {
        return selected().autoConfirmed(directory)
      },
      confirmAuto(directory: string) {
        selected().confirmAuto(directory)
      },
      supportsModes() {
        return selected().supportsModes()
      },
      supportsModesAsync() {
        return selected().supportsModesAsync()
      },
      autoResponds(permission: PermissionRequest, directory?: string) {
        return selected().autoResponds(permission, directory)
      },
      isAutoAccepting(sessionID: string, directory?: string) {
        return selected().isAutoAccepting(sessionID, directory)
      },
      isAutoAcceptingDirectory(directory: string) {
        return selected().isAutoAcceptingDirectory(directory)
      },
      toggleAutoAccept(sessionID: string, directory: string) {
        selected().toggleAutoAccept(sessionID, directory)
      },
      toggleAutoAcceptDirectory(directory: string) {
        selected().toggleAutoAcceptDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        selected().enableAutoAccept(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        selected().disableAutoAccept(sessionID, directory)
      },
      permissionsEnabled,
      isPermissionAllowAll(directory: string) {
        return selected().isPermissionAllowAll(directory)
      },
    }
  },
})

type PermissionState = ReturnType<typeof createServerPermissionState>
type PermissionEvent = Parameters<Parameters<ServerSDK["event"]["listen"]>[0]>[0]

export function createServerPermissionState(
  input: { sdk: ServerSDK; sync: ServerSync },
  options: { persist?: typeof persisted } = {},
) {
  const [store, setStore, _, ready] = (options.persist ?? persisted)(
    {
      ...Persist.serverGlobal(input.sdk.scope, "permission", ["permission.v4"]),
      migrate(value) {
        if (!isRecord(value)) return value

        const data = value
        const autoAccept = normalizeBooleanRecord(isRecord(data.autoAccept) ? data.autoAccept : data.autoAcceptEdits)

        return {
          ...data,
          autoAccept,
          mode: {
            ...migratePermissionModes(autoAccept),
            ...normalizePermissionModes(data.mode),
          },
          autoConfirmed: normalizeBooleanRecord(data.autoConfirmed, true),
        }
      },
    },
    createStore({
      autoAccept: {} as Record<string, boolean>,
      mode: {} as Record<string, Permission.Mode>,
      autoConfirmed: {} as Record<string, boolean>,
    }),
  )
  const [taskMode, setTaskMode] = createStore<Record<string, Permission.Mode>>({})
  const capability = {
    value:
      input.sdk.protocolKind() === "v1"
        ? false
        : input.sdk.supportsPermissionModes()
          ? true
          : (undefined as boolean | undefined),
  }
  const permissionModeCapability = input.sdk.protocol.then(async (protocol) => {
    if (protocol !== "v2") {
      capability.value = false
      return false
    }
    const supported = await input.sdk.permissionModeCapability
    capability.value = supported
    return supported
  })

  function enableConfiguredDirectory(directory: string) {
    if (input.sdk.protocolKind() !== "v1") return
    if (meta.disposed || !ready()) return
    const [childStore] = input.sync.child(directory)
    if (childStore.config.permission !== "allow") return
    const key = directoryAcceptKey(directory)
    if (store.autoAccept[key] !== undefined) return
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )
  }

  const MAX_RESPONDED = 1000
  const RESPONDED_TTL_MS = 60 * 60 * 1000
  const responded = new Map<string, number>()
  const enableVersion = new Map<string, number>()
  const modeSwitch = new Map<string, { version: number; mode: Permission.Mode }>()
  const modeQueue = new Map<string, Promise<void>>()
  const meta = { disposed: false }

  function pruneResponded(now: number) {
    for (const [id, ts] of responded) {
      if (now - ts < RESPONDED_TTL_MS) break
      responded.delete(id)
    }

    for (const id of responded.keys()) {
      if (responded.size <= MAX_RESPONDED) break
      responded.delete(id)
    }
  }

  const respond: PermissionRespondFn = (request) => {
    if (meta.disposed) return
    input.sdk.api.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.permissionID,
        reply: request.response,
        location: request.directory ? { directory: request.directory } : undefined,
      })
      .catch(() => {
        responded.delete(request.permissionID)
      })
  }

  const list = async (directory: string) => {
    if ((await input.sdk.protocol) === "v1") {
      return (await input.sdk.client.permission.list({ directory })).data ?? []
    }
    return input.sdk.api.permission.request
      .list({ location: { directory } })
      .then((result) => result.data.map(normalizePermissionRequest))
  }

  function respondOnce(permission: PermissionRequest, directory?: string) {
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    respond({
      sessionID: permission.sessionID,
      permissionID: permission.id,
      response: "once",
      directory,
    })
  }

  function sessions(directory?: string) {
    const info = Object.values(input.sync.session.data.info).filter((session) => !!session)
    if (!directory) return info
    return [...info, ...input.sync.child(directory, { bootstrap: false })[0].session]
  }

  function supportsModes() {
    if (capability.value !== undefined) return capability.value
    return input.sdk.protocolKind() === "v2" && input.sdk.supportsPermissionModes()
  }

  async function supportsModesAsync() {
    return permissionModeCapability
  }

  function projectMode(directory: string) {
    return projectPermissionMode(store.mode, directory)
  }

  function serverMode(sessionID: string, directory: string) {
    const session = sessions(directory).find((session) => session.id === sessionID)
    if (!session || !("permissionMode" in session)) return undefined
    return normalizePermissionMode(session.permissionMode)
  }

  function mode(sessionID: string | undefined, directory: string): Permission.Mode {
    if (!sessionID) return projectMode(directory)
    if (!supportsModes()) return isAutoAccepting(sessionID, directory) ? "auto" : "standard"
    return taskMode[sessionID] ?? taskPermissionMode(serverMode(sessionID, directory), projectMode(directory))
  }

  function autoResponseTaskMode() {
    const result = { ...taskMode }
    modeSwitch.forEach((switching, sessionID) => {
      if (switching.mode === "auto") return
      result[sessionID] = switching.mode
    })
    return result
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    return autoRespondsPermission(store.autoAccept, sessions(directory), { sessionID }, directory)
  }

  function isAutoAcceptingDirectory(directory: string) {
    return isDirectoryAutoAccepting(store.autoAccept, directory)
  }

  function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
    if (capability.value === undefined) return false
    if (capability.value) return modeAutoRespondsPermission(autoResponseTaskMode(), sessions(directory), permission)
    return autoRespondsPermission(store.autoAccept, sessions(directory), permission, directory)
  }

  function isPending(permission: PermissionRequest) {
    const pending = input.sync.session.data.permission[permission.sessionID]
    return pending === undefined || pending.some((item) => item.id === permission.id)
  }

  async function shouldAutoRespondResolved(permission: PermissionRequest, directory?: string) {
    if (await supportsModesAsync()) {
      const override = lineagePermissionMode(autoResponseTaskMode(), sessions(directory), permission)
      if (override !== undefined) return override === "auto"
      if (input.sync.session.lineage.peek(permission.sessionID)) return shouldAutoRespond(permission, directory)
      const lineage = await input.sync.session.lineage.resolve(permission.sessionID).catch(() => undefined)
      if (meta.disposed || !lineage) return false
      return shouldAutoRespond(permission, directory)
    }

    const override = sessionAutoAccept(store.autoAccept, sessions(directory), permission, directory)
    if (override !== undefined) return override
    if (input.sync.session.lineage.peek(permission.sessionID)) return shouldAutoRespond(permission, directory)
    const lineage = await input.sync.session.lineage.resolve(permission.sessionID).catch(() => undefined)
    if (meta.disposed || !lineage) return false
    return shouldAutoRespond(permission, directory)
  }

  function pendingPermissions(sessionID?: string) {
    return Object.entries(input.sync.session.data.permission).flatMap(([id, permissions]) => {
      if (sessionID && sessionID !== id) return []
      return permissions ?? []
    })
  }

  function sessionDirectory(sessionID: string) {
    return sessions().find((session) => session.id === sessionID)?.directory
  }

  async function sweepPending(value: {
    directory?: string
    sessionID?: string
    permissions?: PermissionRequest[]
    refresh?: boolean
    current?: () => boolean
  }) {
    await supportsModesAsync()
    if (meta.disposed || value.current?.() === false) return
    const remote = value.refresh && value.directory ? await list(value.directory).catch(() => []) : []
    const permissions = [...(value.permissions ?? pendingPermissions(value.sessionID)), ...remote]
      .filter((permission) => !value.sessionID || permission.sessionID === value.sessionID)
      .filter((permission, index, all) => all.findIndex((item) => item.id === permission.id) === index)
    await Promise.all(
      permissions.map((permission) =>
        respondPending(permission, value.directory ?? sessionDirectory(permission.sessionID), value.current),
      ),
    )
  }

  async function respondPending(
    permission: PermissionRequest,
    directory?: string,
    current: () => boolean = () => true,
  ) {
    if (!current() || !isPending(permission)) return
    if (!(await shouldAutoRespondResolved(permission, directory))) return
    if (meta.disposed || !current() || !isPending(permission) || !shouldAutoRespond(permission, directory)) return
    respondOnce(permission, directory)
  }

  function bumpEnableVersion(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    const next = (enableVersion.get(key) ?? 0) + 1
    enableVersion.set(key, next)
    return next
  }

  function respondPendingForMode(sessionID: string, directory: string, key: string, version: number) {
    return sweepPending({
      directory,
      sessionID,
      refresh: true,
      current: () => enableVersion.get(key) === version && mode(sessionID, directory) === "auto",
    }).catch(() => undefined)
  }

  function setMode(value: { sessionID?: string; directory: string; mode: Permission.Mode }) {
    if (meta.disposed) return Promise.resolve()
    setStore("mode", directoryAcceptKey(value.directory), value.mode)
    if (!value.sessionID || !supportsModes()) return Promise.resolve()

    const sessionID = value.sessionID
    const key = acceptKey(sessionID, value.directory)
    const version = bumpEnableVersion(sessionID, value.directory)
    modeSwitch.set(sessionID, { version, mode: value.mode })
    const request = (modeQueue.get(sessionID) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() =>
        (input.sdk.api.session as typeof input.sdk.api.session & PermissionModeSessionApi).switchPermissionMode({
          sessionID,
          mode: value.mode,
        }),
      )
    const queued = request.then(
      () => undefined,
      () => undefined,
    )
    modeQueue.set(sessionID, queued)

    return request
      .then(
        () => {
          if (meta.disposed) return Promise.resolve()
          if (modeSwitch.get(sessionID)?.version !== version) return Promise.resolve()
          setTaskMode(sessionID, value.mode)
          modeSwitch.delete(sessionID)
          if (value.mode !== "auto") return Promise.resolve()
          return respondPendingForMode(sessionID, value.directory, key, version)
        },
        (error: unknown) => {
          if (modeSwitch.get(sessionID)?.version !== version) throw error
          modeSwitch.delete(sessionID)
          setTaskMode(
            produce((draft) => {
              delete draft[sessionID]
            }),
          )
          if (!meta.disposed && mode(sessionID, value.directory) === "auto") {
            void respondPendingForMode(sessionID, value.directory, key, version)
          }
          throw error
        },
      )
      .finally(() => {
        if (modeQueue.get(sessionID) === queued) modeQueue.delete(sessionID)
      })
  }

  const handleEvent = (e: PermissionEvent) => {
    const event = e.details as { type: string; properties?: unknown }
    if (event?.type === "permission.asked") {
      if (!isPermissionRequest(event.properties)) return
      void respondPending(event.properties, e.name)
      return
    }
    if (event?.type !== "session.next.permission-mode.switched") return
    if (!isPermissionModeSwitched(event.properties)) return
    const properties = event.properties
    if (modeSwitch.has(properties.sessionID)) return
    const directory = e.name === "global" ? sessionDirectory(properties.sessionID) : e.name
    const key = acceptKey(properties.sessionID, directory)
    const version = bumpEnableVersion(properties.sessionID, directory)
    setTaskMode(properties.sessionID, properties.mode)
    if (properties.mode !== "auto") return
    if (directory) {
      void respondPendingForMode(properties.sessionID, directory, key, version)
      return
    }
    void sweepPending({
      sessionID: properties.sessionID,
      current: () => enableVersion.get(key) === version && taskMode[properties.sessionID] === "auto",
    })
  }

  const unsubscribe = input.sdk.event.listen((event) => {
    if (ready()) {
      handleEvent(event)
      return
    }
    void ready.promise?.then(() => {
      if (meta.disposed) return
      handleEvent(event)
    })
  })

  createEffect(() => {
    if (!ready()) return
    const permissions = pendingPermissions()
    if (permissions.length === 0) return
    void sweepPending({ permissions })
  })

  void permissionModeCapability.then(() => {
    if (meta.disposed || !ready()) return
    void sweepPending({ permissions: pendingPermissions() })
  })
  onCleanup(() => {
    meta.disposed = true
    unsubscribe()
  })

  function enableDirectory(directory: string) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (!isAutoAcceptingDirectory(directory)) return
        for (const permission of permissions) {
          void respondPending(permission, directory, () => isAutoAcceptingDirectory(directory))
        }
      })
      .catch(() => undefined)
  }

  function disableDirectory(directory: string) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
      }),
    )
  }

  function enable(sessionID: string, directory: string) {
    if (meta.disposed) return
    const key = acceptKey(sessionID, directory)
    const version = bumpEnableVersion(sessionID, directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
        delete draft.autoAccept[sessionID]
      }),
    )

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (enableVersion.get(key) !== version) return
        if (!isAutoAccepting(sessionID, directory)) return
        for (const permission of permissions) {
          void respondPending(
            permission,
            directory,
            () => enableVersion.get(key) === version && isAutoAccepting(sessionID, directory),
          )
        }
      })
      .catch(() => undefined)
  }

  function disable(sessionID: string, directory?: string) {
    if (meta.disposed) return
    bumpEnableVersion(sessionID, directory)
    const key = directory ? acceptKey(sessionID, directory) : sessionID
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
        if (!directory) return
        delete draft.autoAccept[sessionID]
      }),
    )
  }

  const api = {
    ready: () => !meta.disposed && ready(),
    respond,
    projectMode,
    mode,
    setMode,
    autoConfirmed(directory: string) {
      if (meta.disposed) return false
      return store.autoConfirmed[directoryAcceptKey(directory)] ?? false
    },
    confirmAuto(directory: string) {
      if (meta.disposed) return
      setStore("autoConfirmed", directoryAcceptKey(directory), true)
    },
    supportsModes,
    supportsModesAsync,
    autoResponds(permission: PermissionRequest, directory?: string) {
      if (meta.disposed) return false
      return shouldAutoRespond(permission, directory)
    },
    isAutoAccepting(sessionID: string, directory?: string) {
      if (meta.disposed) return false
      return isAutoAccepting(sessionID, directory)
    },
    isAutoAcceptingDirectory(directory: string) {
      if (meta.disposed) return false
      return isAutoAcceptingDirectory(directory)
    },
    toggleAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) {
        disable(sessionID, directory)
        return
      }

      enable(sessionID, directory)
    },
    toggleAutoAcceptDirectory(directory: string) {
      if (meta.disposed) return
      if (isAutoAcceptingDirectory(directory)) {
        disableDirectory(directory)
        return
      }
      enableDirectory(directory)
    },
    enableAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) return
      enable(sessionID, directory)
    },
    disableAutoAccept(sessionID: string, directory?: string) {
      if (meta.disposed) return
      disable(sessionID, directory)
    },
    isPermissionAllowAll(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return childStore.config.permission === "allow"
    },
  }

  return {
    ...api,
    api,
    sync: input.sync,
    enableConfiguredDirectory,
    permissionsEnabled(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return hasPermissionPromptRules(childStore.config.permission)
    },
  }
}

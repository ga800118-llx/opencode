import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Permission } from "@opencode-ai/schema/permission"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerSDK } from "./server-sdk"
import type { ServerSync } from "./server-sync"
import { directoryAcceptKey } from "./permission-auto-respond"
import { migratePermissionModes, projectPermissionMode, taskPermissionMode } from "./permission-mode"

let createServerPermissionState: typeof import("./permission").createServerPermissionState
let scope = 0
const disposals: VoidFunction[] = []

beforeAll(async () => {
  createServerPermissionState = (await import("./permission")).createServerPermissionState
})

afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose())
})

describe("projectPermissionMode", () => {
  test("defaults each project to standard", () => {
    expect(projectPermissionMode({}, "/project")).toBe("standard")
    expect(projectPermissionMode({ [directoryAcceptKey("/other")]: "auto" }, "/project")).toBe("standard")
  })

  test("uses the directory-keyed project mode", () => {
    expect(projectPermissionMode({ [directoryAcceptKey("/project")]: "auto" }, "/project")).toBe("auto")
  })

  test("reads legacy equivalent project keys before persistence migration", () => {
    expect(projectPermissionMode({ [`${base64Encode("/project/")}/*`]: "auto" }, "/project")).toBe("auto")
  })

  test("ignores invalid persisted modes", () => {
    expect(projectPermissionMode({ [directoryAcceptKey("/project")]: "always" }, "/project")).toBe("standard")
  })
})

describe("migratePermissionModes", () => {
  test("migrates only enabled directory-level auto-accept entries", () => {
    const directory = directoryAcceptKey("/project")
    expect(
      migratePermissionModes({
        [directory]: true,
        [directoryAcceptKey("/disabled")]: false,
        session: true,
      }),
    ).toEqual({ [directory]: "auto" })
  })

  test("normalizes legacy directory keys while migrating", () => {
    expect(migratePermissionModes({ [`${base64Encode("C:\\project\\")}/*`]: true })).toEqual({
      [directoryAcceptKey("C:/project")]: "auto",
    })
  })
})

describe("taskPermissionMode", () => {
  test("prefers the server-confirmed task mode", () => {
    expect(taskPermissionMode("restricted", "auto")).toBe("restricted")
  })

  test("keeps old tasks standard when the server has no mode", () => {
    expect(taskPermissionMode(undefined, "auto")).toBe("standard")
  })
})

describe("V2 permission mode state", () => {
  test("keeps draft defaults and auto confirmation local", async () => {
    const harness = setup({})

    expect(harness.state.supportsModes()).toBe(true)
    expect(harness.state.mode(undefined, "/project")).toBe("standard")
    expect(harness.state.autoConfirmed("/project")).toBe(false)

    harness.state.confirmAuto("/project")
    await harness.state.setMode({ directory: "/project", mode: "auto" })

    expect(harness.state.mode(undefined, "/project")).toBe("auto")
    expect(harness.state.autoConfirmed("/project")).toBe(true)
    expect(harness.switches).toEqual([])
  })

  test("waits for the shared V2 capability result", async () => {
    const capability = Promise.withResolvers<boolean>()
    const harness = setup({ supportsPermissionModes: false, permissionModeCapability: capability.promise })

    expect(harness.state.supportsModes()).toBe(false)
    const result = harness.state.supportsModesAsync()
    capability.resolve(true)

    expect(await result).toBe(true)
  })

  test("updates the current task only after the API succeeds", async () => {
    const gate = Promise.withResolvers<void>()
    const harness = setup({ permissionMode: "standard", switchMode: () => gate.promise })

    const changing = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })

    expect(harness.state.projectMode("/project")).toBe("auto")
    expect(harness.state.mode("session", "/project")).toBe("standard")

    gate.resolve()
    await changing

    expect(harness.state.mode("session", "/project")).toBe("auto")
  })

  test("keeps the confirmed task mode after an API failure", async () => {
    const harness = setup({
      permissionMode: "restricted",
      switchMode: () => Promise.reject(new Error("switch failed")),
    })

    const changing = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })

    expect(harness.state.projectMode("/project")).toBe("auto")
    expect(harness.state.mode("session", "/project")).toBe("restricted")
    await expect(changing).rejects.toThrow("switch failed")
    expect(harness.state.mode("session", "/project")).toBe("restricted")
  })

  test("serializes same-session switches and lets the latest request win after an older failure", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const requests = [first, second]
    const harness = setup({
      permissionMode: "standard",
      switchMode: () => requests.shift()!.promise,
    })

    const older = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    await Bun.sleep(0)
    const latest = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })
    await Bun.sleep(0)

    expect(harness.switches).toEqual([{ sessionID: "session", mode: "auto" }])

    first.reject(new Error("older switch failed"))
    await expect(older).rejects.toThrow("older switch failed")
    await Bun.sleep(0)
    expect(harness.switches).toEqual([
      { sessionID: "session", mode: "auto" },
      { sessionID: "session", mode: "restricted" },
    ])

    second.resolve()
    await latest
    expect(harness.state.mode("session", "/project")).toBe("restricted")
  })

  test("keeps auto responses disabled until the latest queued auto switch succeeds", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const requests = [first, second]
    const request = permission("permission", "session")
    const harness = setup({
      permissionMode: "auto",
      switchMode: () => requests.shift()!.promise,
    })
    await Bun.sleep(0)

    const restricted = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })
    await Bun.sleep(0)
    const auto = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    harness.ask(request)
    await Bun.sleep(0)

    expect(harness.replies).toEqual([])
    expect(harness.switches).toEqual([{ sessionID: "session", mode: "restricted" }])

    first.resolve()
    await restricted
    await Bun.sleep(0)
    expect(harness.switches).toEqual([
      { sessionID: "session", mode: "restricted" },
      { sessionID: "session", mode: "auto" },
    ])
    expect(harness.replies).toEqual([])

    second.resolve()
    await auto
    await Bun.sleep(0)
    expect(harness.replies).toHaveLength(1)
  })

  test("keeps the last confirmed queued mode when the latest switch fails", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const requests = [first, second]
    const harness = setup({
      permissionMode: "auto",
      switchMode: () => requests.shift()!.promise,
    })
    await Bun.sleep(0)

    const restricted = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })
    await Bun.sleep(0)
    const auto = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    harness.ask(permission("permission", "session"))

    first.resolve()
    await restricted
    await Bun.sleep(0)
    second.reject(new Error("latest switch failed"))
    await expect(auto).rejects.toThrow("latest switch failed")
    await Bun.sleep(0)

    expect(harness.state.mode("session", "/project")).toBe("restricted")
    expect(harness.replies).toEqual([])
  })

  test("keeps a newer cross-window mode when an older local switch resolves", async () => {
    const gate = Promise.withResolvers<void>()
    const request = permission("permission", "session")
    const harness = setup({
      permissionMode: "standard",
      switchMode: () => gate.promise,
      resolveMode: () => "restricted",
    })

    const changing = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    await Bun.sleep(0)
    harness.switchEvent("restricted")
    harness.ask(request)
    await Bun.sleep(0)

    expect(harness.state.mode("session", "/project")).toBe("restricted")
    expect(harness.replies).toEqual([])

    gate.resolve()
    await changing
    await Bun.sleep(0)
    expect(harness.state.mode("session", "/project")).toBe("restricted")
    expect(harness.replies).toEqual([])
  })

  test("uses an own mode event while the matching local request is unresolved", async () => {
    const gate = Promise.withResolvers<void>()
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "standard", switchMode: () => gate.promise })

    const changing = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    await Bun.sleep(0)
    harness.switchEvent("auto")
    harness.ask(request)
    await Bun.sleep(0)

    expect(harness.state.mode("session", "/project")).toBe("auto")
    expect(harness.replies).toEqual([])

    gate.resolve()
    await changing
    await Bun.sleep(0)
    expect(harness.state.mode("session", "/project")).toBe("auto")
    expect(harness.replies).toHaveLength(1)
  })

  test("refreshes past a delayed old auto event before completing queued restricted", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const requests = [first, second]
    const harness = setup({
      permissionMode: "standard",
      switchMode: () => requests.shift()!.promise,
    })

    const auto = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    await Bun.sleep(0)
    const restricted = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })

    first.resolve()
    await auto
    await Bun.sleep(0)
    harness.switchEvent("auto")
    harness.ask(permission("permission", "session"))
    await Bun.sleep(0)
    expect(harness.replies).toEqual([])

    second.resolve()
    await restricted
    await Bun.sleep(0)
    expect(harness.state.mode("session", "/project")).toBe("restricted")
    expect(harness.projectedMode()).toBe("restricted")
    expect(harness.replies).toEqual([])
  })

  test("uses an authoritative bootstrap projection over a previous local auto switch", async () => {
    const harness = setup({ permissionMode: "standard" })

    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    expect(harness.state.mode("session", "/project")).toBe("auto")

    harness.project("restricted")
    harness.ask(permission("permission", "session"))
    await Bun.sleep(0)

    expect(harness.state.mode("session", "/project")).toBe("restricted")
    expect(harness.replies).toEqual([])
  })

  test("forces a session refresh after a successful switch without SSE", async () => {
    const harness = setup({ permissionMode: "standard" })

    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })

    expect(harness.resolves).toEqual([{ sessionID: "session", force: true }])
    expect(harness.projectedMode()).toBe("auto")
    expect(harness.state.mode("session", "/project")).toBe("auto")
  })

  test("ignores a stale auto event after a forced refresh confirms restricted", async () => {
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "auto" })

    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })
    harness.bootstrap(request)
    harness.modeEvent("auto")
    await Bun.sleep(0)

    expect(harness.projectedMode()).toBe("restricted")
    expect(harness.state.mode("session", "/project")).toBe("restricted")
    expect(harness.replies).toEqual([])
  })

  test("does not send a queued switch after the permission state is disposed", async () => {
    const gate = Promise.withResolvers<void>()
    const harness = setup({
      permissionMode: "standard",
      switchMode: () => (harness.switches.length === 1 ? gate.promise : Promise.resolve()),
    })

    const first = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })
    await Bun.sleep(0)
    const queued = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    harness.dispose()
    gate.resolve()
    await Promise.all([first, queued])

    expect(harness.switches).toEqual([{ sessionID: "session", mode: "restricted" }])
  })

  test("entering auto responds to existing pending requests once", async () => {
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "standard", pending: [request, request] })

    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    await Bun.sleep(0)

    expect(harness.replies).toEqual([
      {
        sessionID: "session",
        requestID: "permission",
        reply: "once",
        location: { directory: "/project" },
      },
    ])
  })

  test("retries an auto reply once after a transient failure", async () => {
    let attempts = 0
    const harness = setup({
      permissionMode: "auto",
      reply: () => {
        attempts++
        if (attempts === 1) return Promise.reject(new Error("temporary reply failure"))
        return Promise.resolve()
      },
    })
    await Bun.sleep(0)

    harness.ask(permission("permission", "session"))
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(attempts).toBe(2)
    expect(harness.replies).toHaveLength(2)
  })

  test("bounds repeated auto reply failures to two attempts", async () => {
    let attempts = 0
    const harness = setup({
      permissionMode: "auto",
      reply: () => {
        attempts++
        return Promise.reject(new Error("reply failed"))
      },
    })
    await Bun.sleep(0)

    harness.ask(permission("permission", "session"))
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(attempts).toBe(2)
    expect(harness.replies).toHaveLength(2)
  })

  test("waits for capability before deciding against legacy auto-accept", async () => {
    const capability = Promise.withResolvers<boolean>()
    const request = permission("permission", "session")
    const harness = setup({
      permissionMode: "restricted",
      supportsPermissionModes: false,
      permissionModeCapability: capability.promise,
    })

    harness.state.enableAutoAccept("session", "/project")
    harness.ask(request)
    await Bun.sleep(0)
    expect(harness.replies).toEqual([])

    capability.resolve(true)
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(harness.replies).toEqual([])
  })

  test("sweeps startup pending requests when capability resolves", async () => {
    const capability = Promise.withResolvers<boolean>()
    const request = permission("permission", "session")
    const harness = setup({
      permissionMode: "auto",
      supportsPermissionModes: false,
      permissionModeCapability: capability.promise,
      pending: [request],
    })

    await Bun.sleep(0)
    expect(harness.replies).toEqual([])
    capability.resolve(true)
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(harness.replies).toEqual([
      {
        sessionID: "session",
        requestID: "permission",
        reply: "once",
        location: { directory: "/project" },
      },
    ])
  })

  test("sweeps pending requests loaded by bootstrap after capability is ready", async () => {
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "auto" })

    harness.bootstrap(request)
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(harness.replies).toEqual([
      {
        sessionID: "session",
        requestID: "permission",
        reply: "once",
        location: { directory: "/project" },
      },
    ])
  })

  test("does not sweep pending requests for restricted or standard tasks", async () => {
    for (const mode of ["restricted", "standard"] as const) {
      const capability = Promise.withResolvers<boolean>()
      const harness = setup({
        permissionMode: mode,
        supportsPermissionModes: false,
        permissionModeCapability: capability.promise,
        pending: [permission(`permission-${mode}`, "session")],
      })

      capability.resolve(true)
      await Bun.sleep(0)
      await Bun.sleep(0)
      expect(harness.replies).toEqual([])
    }
  })

  test("applies cross-window mode events and sweeps newly auto tasks", async () => {
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "standard", pending: [request] })

    harness.switchEvent("auto")
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(harness.state.mode("session", "/project")).toBe("auto")
    expect(harness.replies).toHaveLength(1)

    harness.switchEvent("restricted")
    expect(harness.state.mode("session", "/project")).toBe("restricted")
  })

  test("leaving auto invalidates delayed pending responses", async () => {
    const request = permission("permission", "session")
    const list = Promise.withResolvers<{ data: ReturnType<typeof currentPermission>[] }>()
    const harness = setup({ permissionMode: "standard", pending: [request], list: () => list.promise })
    await Bun.sleep(0)

    const entering = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "auto" })
    await Bun.sleep(0)
    expect(harness.state.mode("session", "/project")).toBe("auto")

    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "standard" })
    list.resolve({ data: [currentPermission(request)] })
    await entering
    await Bun.sleep(0)

    expect(harness.replies).toEqual([])
  })

  test("resumes pending auto responses when the latest switch away fails", async () => {
    const gate = Promise.withResolvers<void>()
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "auto", switchMode: () => gate.promise })

    const leaving = harness.state.setMode({ sessionID: "session", directory: "/project", mode: "standard" })
    harness.ask(request)
    await Bun.sleep(0)

    expect(harness.replies).toEqual([])

    gate.reject(new Error("switch failed"))
    await expect(leaving).rejects.toThrow("switch failed")
    await Bun.sleep(0)

    expect(harness.replies).toEqual([
      {
        sessionID: "session",
        requestID: "permission",
        reply: "once",
        location: { directory: "/project" },
      },
    ])
  })

  test("does not expose mode switching or restricted state on V1", async () => {
    const harness = setup({ protocol: "v1", permissionMode: "restricted" })

    expect(harness.state.supportsModes()).toBe(false)
    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })

    expect(harness.state.mode("session", "/project")).toBe("standard")
    expect(harness.switches).toEqual([])
  })

  test("keeps legacy auto-accept behavior on V2 servers without the capability", async () => {
    const request = permission("permission", "session")
    const harness = setup({ permissionMode: "restricted", supportsPermissionModes: false })

    expect(harness.state.supportsModes()).toBe(false)
    harness.state.enableAutoAccept("session", "/project")
    harness.ask(request)
    await Bun.sleep(0)

    expect(harness.state.mode("session", "/project")).toBe("auto")
    expect(harness.replies).toEqual([
      {
        sessionID: "session",
        requestID: "permission",
        reply: "once",
        location: { directory: "/project" },
      },
    ])

    await harness.state.setMode({ sessionID: "session", directory: "/project", mode: "restricted" })
    expect(harness.switches).toEqual([])
  })
})

function permission(id: string, sessionID: string): PermissionRequest {
  return { id, sessionID, permission: "edit", patterns: ["*"], metadata: {}, always: [] }
}

function currentPermission(request: PermissionRequest) {
  return {
    id: request.id,
    sessionID: request.sessionID,
    action: request.permission,
    resources: request.patterns,
  }
}

function setup(input: {
  protocol?: "v1" | "v2"
  supportsPermissionModes?: boolean
  permissionModeCapability?: Promise<boolean>
  permissionMode?: Permission.Mode
  pending?: PermissionRequest[]
  switchMode?: (input: { sessionID: string; mode: Permission.Mode }) => Promise<void>
  list?: () => Promise<{ data: ReturnType<typeof currentPermission>[] }>
  reply?: (input: unknown) => Promise<void>
  resolveMode?: () => Permission.Mode
}) {
  type ProjectedSession = Session & { permissionMode?: Permission.Mode }
  const record = {
    id: "session",
    directory: "/project",
    permissionMode: input.permissionMode,
  } as ProjectedSession
  const pending = input.pending ?? []
  let authoritativeMode = input.permissionMode
  const replies: unknown[] = []
  const switches: Array<{ sessionID: string; mode: Permission.Mode }> = []
  const resolves: Array<{ sessionID: string; force: boolean }> = []
  type TestEvent =
    | { name: string; details: { type: "permission.asked"; properties: PermissionRequest } }
    | {
        name: string
        details: {
          type: "session.next.permission-mode.switched"
          properties: { sessionID: string; mode: Permission.Mode }
        }
      }
  const events: { permission?: (event: TestEvent) => void } = {}
  const [sessionData, setSessionData] = createStore({
    info: { session: record } as Record<string, ProjectedSession | undefined>,
    permission: { session: pending } as Record<string, PermissionRequest[]>,
  })
  const sync = {
    session: {
      data: sessionData,
      resolve: async (sessionID: string, options: { force?: boolean } = {}) => {
        resolves.push({ sessionID, force: options.force === true })
        const mode = input.resolveMode?.() ?? authoritativeMode
        const next = { ...record, permissionMode: mode }
        setSessionData("info", sessionID, next)
        return next
      },
      lineage: {
        peek: () => ({ session: record, root: record }),
        resolve: async () => ({ session: record, root: record }),
      },
    },
    child: () => [{ session: [record], config: { permission: {} } }],
  } as unknown as ServerSync
  const sdk = {
    scope: `permission-mode-test-${scope++}`,
    protocol: Promise.resolve(input.protocol ?? "v2"),
    protocolKind: () => input.protocol ?? "v2",
    permissionModeCapability: input.permissionModeCapability ?? Promise.resolve(input.supportsPermissionModes ?? true),
    supportsPermissionModes: () => input.supportsPermissionModes ?? true,
    api: {
      session: {
        switchPermissionMode: (value: { sessionID: string; mode: Permission.Mode }) => {
          switches.push(value)
          return (input.switchMode?.(value) ?? Promise.resolve()).then(() => {
            authoritativeMode = value.mode
          })
        },
      },
      permission: {
        reply: (value: unknown) => {
          replies.push(value)
          return input.reply?.(value) ?? Promise.resolve()
        },
        request: {
          list: input.list ?? (() => Promise.resolve({ data: pending.map(currentPermission) })),
        },
      },
    },
    event: {
      listen: (listener: NonNullable<typeof events.permission>) => {
        events.permission = listener
        return () => undefined
      },
    },
  } as unknown as ServerSDK
  let disposeState: () => void = () => undefined
  const state = createRoot((dispose) => {
    disposeState = dispose
    disposals.push(dispose)
    return createServerPermissionState(
      { sdk, sync },
      {
        persist: ((_target: unknown, store: unknown[]) => [
          store[0],
          store[1],
          null,
          Object.assign(() => true, { promise: undefined }),
        ]) as unknown as typeof import("@/utils/persist").persisted,
      },
    ).api
  })
  const modeEvent = (mode: Permission.Mode) =>
    events.permission?.({
      name: "/project",
      details: {
        type: "session.next.permission-mode.switched",
        properties: { sessionID: "session", mode },
      },
    })
  return {
    state,
    replies,
    switches,
    resolves,
    dispose: () => disposeState(),
    project(mode: Permission.Mode) {
      authoritativeMode = mode
      setSessionData("info", "session", { ...record, permissionMode: mode })
    },
    projectedMode() {
      return sessionData.info.session?.permissionMode
    },
    ask(request: PermissionRequest) {
      pending.push(request)
      events.permission?.({ name: "/project", details: { type: "permission.asked", properties: request } })
    },
    bootstrap(request: PermissionRequest) {
      pending.push(request)
      setSessionData("permission", request.sessionID, [request])
    },
    modeEvent,
    switchEvent(mode: Permission.Mode) {
      authoritativeMode = mode
      setSessionData("info", "session", { ...record, permissionMode: mode })
      modeEvent(mode)
    },
  }
}

import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import type { Permission } from "@opencode-ai/schema/permission"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { createRoot } from "solid-js"
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

  test("leaving auto invalidates delayed pending responses", async () => {
    const request = permission("permission", "session")
    const list = Promise.withResolvers<{ data: ReturnType<typeof currentPermission>[] }>()
    const harness = setup({ permissionMode: "standard", pending: [request], list: () => list.promise })

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
  permissionMode?: Permission.Mode
  pending?: PermissionRequest[]
  switchMode?: (input: { sessionID: string; mode: Permission.Mode }) => Promise<void>
  list?: () => Promise<{ data: ReturnType<typeof currentPermission>[] }>
}) {
  const record = {
    id: "session",
    directory: "/project",
    permissionMode: input.permissionMode,
  } as Session & { permissionMode?: Permission.Mode }
  const pending = input.pending ?? []
  const replies: unknown[] = []
  const switches: Array<{ sessionID: string; mode: Permission.Mode }> = []
  const events: {
    permission?: (event: { name: string; details: { type: "permission.asked"; properties: PermissionRequest } }) => void
  } = {}
  const sync = {
    session: {
      data: {
        info: { session: record },
        permission: { session: pending },
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
    supportsPermissionModes: () => input.supportsPermissionModes ?? true,
    api: {
      session: {
        switchPermissionMode: (value: { sessionID: string; mode: Permission.Mode }) => {
          switches.push(value)
          return input.switchMode?.(value) ?? Promise.resolve()
        },
      },
      permission: {
        reply: (value: unknown) => {
          replies.push(value)
          return Promise.resolve()
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
  const state = createRoot((dispose) => {
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
  return {
    state,
    replies,
    switches,
    ask(request: PermissionRequest) {
      pending.push(request)
      events.permission?.({ name: "/project", details: { type: "permission.asked", properties: request } })
    },
  }
}

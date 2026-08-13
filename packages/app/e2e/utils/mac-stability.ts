import type { Page, Route } from "@playwright/test"
import { checksum } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "./mock-server"

export const mockServer = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
export const protocols = ["v1", "v2"] as const

const workspaceStorage = (directory: string) => {
  const value = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  return `opencode.workspace.${(value.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")}.${checksum(value) ?? "0"}.dat`
}

export function projectFixture(directory: string, input: { id?: string; name?: string; color?: string } = {}) {
  return {
    id: input.id ?? "proj_mac_stability",
    worktree: directory,
    vcs: "git",
    name: input.name ?? directory.split("/").at(-1) ?? "MacStability",
    icon: input.color ? { color: input.color } : undefined,
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    sandboxes: [],
  }
}

export function providerFixture(input: { providerID?: string; modelID?: string; modelName?: string } = {}) {
  const providerID = input.providerID ?? "mock-provider"
  const modelID = input.modelID ?? "mock-model"
  return {
    all: [
      {
        id: providerID,
        name: "Deterministic Provider",
        models: {
          [modelID]: {
            id: modelID,
            name: input.modelName ?? "Deterministic Model",
            cost: { input: 1, output: 2 },
            limit: { context: 200_000, output: 8_192 },
          },
        },
      },
    ],
    connected: [providerID],
    default: { providerID, modelID },
  }
}

export function sessionFixture(directory: string, input: { id?: string; projectID?: string; title?: string } = {}) {
  const id = input.id ?? "ses_mac_stability"
  return {
    id,
    slug: id,
    projectID: input.projectID ?? "proj_mac_stability",
    directory,
    title: input.title ?? "Mac stability regression",
    version: "dev",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  }
}

export async function isolateAppStorage(
  page: Page,
  input: {
    projects?: Array<{ worktree: string; expanded?: boolean }>
    tabs?: unknown[]
    locale?: string
    settings?: Record<string, unknown>
    projectMeta?: { storage: string; value: unknown }
    failProjectMetaWrites?: { name: string; count: number }
  } = {},
) {
  await page.addInitScript((seed) => {
    const marker = "__mac_stability_e2e_seeded__"
    if (sessionStorage.getItem(marker)) return
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem(marker, "true")
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true, ...seed.settings } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: seed.projects ?? [] } }))
    if (seed.tabs) localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify(seed.tabs))
    if (seed.locale) localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: seed.locale }))
    if (seed.projectMeta) {
      localStorage.setItem(
        `${seed.projectMeta.storage}:workspace:project`,
        JSON.stringify({ value: seed.projectMeta.value }),
      )
    }
    if (seed.failProjectMetaWrites) {
      const stringify = JSON.stringify
      let remaining = seed.failProjectMetaWrites.count
      JSON.stringify = ((value, replacer, space) => {
        const project = value as { value?: { name?: string } } | undefined
        if (project?.value?.name === seed.failProjectMetaWrites?.name && remaining > 0) {
          remaining--
          throw new Error("Fixture rejected the project metadata write")
        }
        if (typeof replacer === "function") return stringify(value, replacer, space)
        return stringify(value, replacer, space)
      }) as typeof JSON.stringify
    }
  }, input)
}

export async function setupMockApp(
  page: Page,
  input: {
    directory: string
    protocol?: "v1" | "v2"
    project?: ReturnType<typeof projectFixture>
    projectMeta?: { commands?: { start?: string } }
    sessions?: ReturnType<typeof sessionFixture>[]
    projects?: Array<{ worktree: string; expanded?: boolean }>
    tabs?: unknown[]
    provider?: ReturnType<typeof providerFixture>
    agents?: import("./mock-server").MockServerConfig["agents"]
    fileList?: (path: string) => unknown | Promise<unknown>
    findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
    failProjectMetaWrites?: { name: string; count?: number }
  },
) {
  const project = input.project ?? projectFixture(input.directory)
  await mockOpenCodeServer(page, {
    protocol: input.protocol,
    directory: input.directory,
    project,
    provider: input.provider ?? providerFixture(),
    agents: input.agents,
    sessions: input.sessions ?? [],
    pageMessages: () => ({ items: [] }),
    fileList: input.fileList,
    findFiles: input.findFiles,
  })
  await page.route("**/pty/shells**", (route) => {
    if (new URL(route.request().url()).pathname !== "/pty/shells") return route.fallback()
    return fulfillJson(route, [])
  })
  await isolateAppStorage(page, {
    projects: input.projects ?? [{ worktree: input.directory, expanded: true }],
    tabs: input.tabs,
    projectMeta: input.projectMeta && {
      storage: workspaceStorage(input.directory),
      value: input.projectMeta,
    },
    failProjectMetaWrites:
      input.failProjectMetaWrites === undefined
        ? undefined
        : {
            name: input.failProjectMetaWrites.name,
            count: input.failProjectMetaWrites.count ?? 1,
          },
  })
  return project
}

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
    },
    body: JSON.stringify(body ?? null),
  })
}

export async function persistedDraftTabs(page: Page) {
  return page.evaluate(() => {
    const value = localStorage.getItem("opencode.window.browser.dat:tabs")
    return value ? (JSON.parse(value) as unknown[]) : []
  })
}

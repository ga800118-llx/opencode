import { expect, test } from "bun:test"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { selectProviderCatalog, selectProviderCatalogReady } from "./provider-catalog"

const catalog = (id: string): NormalizedProviderListResponse => ({
  all: new Map([[id, { id, name: id, source: "api", env: [], options: {}, models: {} }]]),
  connected: [id],
  default: { [id]: `${id}-model` },
})

const privateCatalog = (connected: boolean): NormalizedProviderListResponse => {
  const id = "agent-profile-private"
  const model = {
    id: "private-model",
    providerID: id,
    api: { id: "private-model", url: "", npm: id },
    name: "Private Model",
    family: "private",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_192 },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "2026-08-25",
    variants: {},
  }
  return {
    all: new Map([
      [
        id,
        {
          id,
          name: "Private endpoint",
          source: "api",
          env: [],
          options: {},
          models: { [model.id]: model },
        },
      ],
    ]),
    connected: connected ? [id] : [],
    default: connected ? { [id]: model.id } : {},
  }
}

test("selects the ready catalog for an explicit directory", () => {
  const directory = catalog("directory")

  expect(
    selectProviderCatalog({
      explicit: true,
      directory: "/repo",
      catalog: { ready: true, providers: directory },
      global: catalog("global"),
    }),
  ).toBe(directory)
})

test("keeps a connected desktop private model available in every project", () => {
  const directory = privateCatalog(false)
  const global = privateCatalog(true)

  const result = selectProviderCatalog({
    explicit: true,
    directory: "/project-b",
    catalog: { ready: true, providers: directory },
    global,
  })

  expect(result.connected).toEqual(["agent-profile-private"])
  expect(result.default).toEqual({ "agent-profile-private": "private-model" })
  expect(result.all.get("agent-profile-private")?.models["private-model"]?.name).toBe("Private Model")
})

test("repairs a connected desktop private provider missing from the directory catalog", () => {
  const directory: NormalizedProviderListResponse = {
    all: new Map(),
    connected: ["agent-profile-private"],
    default: {},
  }
  const global = privateCatalog(true)

  const result = selectProviderCatalog({
    explicit: true,
    directory: "/project-b",
    catalog: { ready: true, providers: directory },
    global,
  })

  expect(result).not.toBe(directory)
  expect(result.all.get("agent-profile-private")).toBe(global.all.get("agent-profile-private"))
  expect(result.default).toEqual({ "agent-profile-private": "private-model" })
})

test("replaces a stale desktop private provider and default model", () => {
  const directory = catalog("agent-profile-private")
  const global = privateCatalog(true)

  const result = selectProviderCatalog({
    explicit: true,
    directory: "/project-b",
    catalog: { ready: true, providers: directory },
    global,
  })

  expect(result).not.toBe(directory)
  expect(result.all.get("agent-profile-private")).toBe(global.all.get("agent-profile-private"))
  expect(result.all.get("agent-profile-private")?.models["private-model"]?.name).toBe("Private Model")
  expect(result.default).toEqual({ "agent-profile-private": "private-model" })
})

test("preserves unrelated directory providers and defaults while repairing a desktop private provider", () => {
  const directory = catalog("directory")
  directory.connected.push("agent-profile-private")
  const global = privateCatalog(true)
  const globalDirectory = catalog("directory")
  global.all.set("directory", globalDirectory.all.get("directory")!)
  global.connected.push("directory")
  global.default.directory = "global-directory-model"

  const result = selectProviderCatalog({
    explicit: true,
    directory: "/project-b",
    catalog: { ready: true, providers: directory },
    global,
  })

  expect(result.all.get("directory")).toBe(directory.all.get("directory"))
  expect(result.connected).toEqual(["directory", "agent-profile-private"])
  expect(result.default.directory).toBe("directory-model")
  expect(result.default["agent-profile-private"]).toBe("private-model")
})

test("returns an empty catalog while an explicit directory is unresolved", () => {
  expect(selectProviderCatalog({ explicit: true })).toEqual({ all: new Map(), connected: [], default: {} })
  expect(
    selectProviderCatalog({
      explicit: true,
      directory: "/repo",
      catalog: { ready: false, providers: catalog("directory") },
    }),
  ).toEqual({ all: new Map(), connected: [], default: {} })
})

test("uses the route catalog when it is ready", () => {
  const directory = catalog("directory")

  expect(
    selectProviderCatalog({
      explicit: false,
      directory: "/repo",
      catalog: { ready: true, providers: directory },
      global: catalog("global"),
    }),
  ).toBe(directory)
})

test("falls back to the global catalog for route consumers", () => {
  const global = catalog("global")

  expect(selectProviderCatalog({ explicit: false, global })).toBe(global)
  expect(
    selectProviderCatalog({
      explicit: false,
      directory: "/repo",
      catalog: { ready: false, providers: catalog("directory") },
      global,
    }),
  ).toBe(global)
})

test("selects readiness from the relevant global or workspace catalog", () => {
  expect(selectProviderCatalogReady({ global: false })).toBe(false)
  expect(selectProviderCatalogReady({ global: true })).toBe(true)
  expect(selectProviderCatalogReady({ directory: "/repo", global: true })).toBe(false)
  expect(selectProviderCatalogReady({ directory: "/repo", global: true, catalog: { ready: false } })).toBe(false)
  expect(selectProviderCatalogReady({ directory: "/repo", global: false, catalog: { ready: true } })).toBe(true)
})

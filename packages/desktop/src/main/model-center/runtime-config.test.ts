import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { serializeProviderProfile, type ProductProviderProfile } from "@opencode-ai/app/product/model-center"
import { createDesktopRuntimePaths, ensureDesktopRuntime } from "../runtime-environment"
import { createProductRuntimeConfig, reloadProductRuntimeConfig, writeProductRuntimeConfig } from "./runtime-config"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("product runtime config", () => {
  test("serializes exactly the current presented providers and explicit valid default", () => {
    const first = profile("first", ["coder", "reasoner"])
    const second = profile("second", ["fast", "precise"])
    const presentProfile = presentation()

    const config = createProductRuntimeConfig({
      profiles: [first, second],
      defaultSelection: { profileID: second.id, modelID: "precise" },
      presentProfile,
    })

    expect(config).toEqual({
      provider: {
        [first.providerID]: serializeProviderProfile(presentProfile(first)),
        [second.providerID]: serializeProviderProfile(presentProfile(second)),
      },
      disabled_providers: [],
      model: `${second.providerID}/precise`,
    })
  })

  test("repairs an invalid default by profile and model order and omits an unavailable model", async () => {
    const empty = profile("empty", [])
    const available = profile("available", ["first-model", "second-model"])

    expect(
      createProductRuntimeConfig({
        profiles: [empty, available],
        defaultSelection: { profileID: "missing", modelID: "missing" },
        presentProfile: (item) => item,
      }).model,
    ).toBe(`${available.providerID}/first-model`)
    expect(
      createProductRuntimeConfig({
        profiles: [empty, available],
        defaultSelection: undefined,
        presentProfile: (item) => item,
      }).model,
    ).toBe(`${available.providerID}/first-model`)

    const config = createProductRuntimeConfig({
      profiles: [empty],
      defaultSelection: { profileID: empty.id, modelID: "missing" },
      presentProfile: (item) => item,
    })
    expect(config).toEqual({
      provider: { [empty.providerID]: serializeProviderProfile(empty) },
      disabled_providers: [],
    })
    expect("model" in config).toBe(false)

    const paths = await runtimePaths()
    await writeProductRuntimeConfig({
      paths,
      profiles: [empty],
      defaultSelection: undefined,
      presentProfile: (item) => item,
    })
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).selectedModel).toBeNull()
  })

  test("rewriting removes providers orphaned in the prior overlay", async () => {
    const paths = await runtimePaths()
    await writeFile(
      paths.modelConfig,
      JSON.stringify({ provider: { orphan: { name: "Orphan" } }, disabled_providers: ["orphan"] }),
    )
    const current = profile("current", ["coder"])

    await writeProductRuntimeConfig({
      paths,
      profiles: [current],
      defaultSelection: undefined,
      presentProfile: (item) => item,
    })

    expect(JSON.parse(await readFile(paths.modelConfig, "utf8"))).toEqual(
      createProductRuntimeConfig({
        profiles: [current],
        defaultSelection: undefined,
        presentProfile: (item) => item,
      }),
    )
  })

  test("completes the overlay and manifest before restarting and returns the safe write result", async () => {
    const paths = await runtimePaths()
    const current = profile("reloaded", ["coder", "reviewer"])
    const expected = createProductRuntimeConfig({
      profiles: [current],
      defaultSelection: { profileID: current.id, modelID: "reviewer" },
      presentProfile: presentation(),
    })
    const expectedResult = {
      profileCount: 1,
      providerCount: 1,
      modelCount: 2,
      selectedModel: `${current.providerID}/reviewer`,
    }
    let restarts = 0

    const result = await reloadProductRuntimeConfig({
      paths,
      profiles: [current],
      defaultSelection: { profileID: current.id, modelID: "reviewer" },
      presentProfile: presentation(),
      now: () => new Date("2026-08-15T10:11:12.000Z"),
      restart: async (written) => {
        restarts += 1
        expect(written).toEqual(expectedResult)
        expect(JSON.parse(await readFile(paths.modelConfig, "utf8"))).toEqual(expected)
        expect(JSON.parse(await readFile(paths.manifest, "utf8"))).toMatchObject({
          generatedAt: "2026-08-15T10:11:12.000Z",
          counts: { profiles: 1, providers: 1, models: 2 },
          selectedModel: `${current.providerID}/reviewer`,
        })
        expect(JSON.parse(await readFile(paths.migrationMarker, "utf8"))).toEqual({
          schemaVersion: 1,
          isolatedAt: "2026-08-15T10:11:12.000Z",
        })
      },
    })

    expect(restarts).toBe(1)
    expect(result).toEqual(expectedResult)
  })

  test("a failed overlay rename preserves the prior overlay, cleans its temporary file, and skips restart", async () => {
    const paths = await runtimePaths()
    const previous = { provider: { stable: { name: "Stable" } }, disabled_providers: [], model: "stable/coder" }
    await writeFile(paths.modelConfig, JSON.stringify(previous))
    let restarts = 0

    expect(
      reloadProductRuntimeConfig({
        paths,
        profiles: [profile("replacement", ["coder"])],
        defaultSelection: undefined,
        presentProfile: (item) => item,
        restart: async () => {
          restarts += 1
        },
        randomUUID: () => "failed-write",
        fileSystem: {
          rename: async (source, destination) => {
            if (destination === paths.modelConfig) throw new Error("simulated overlay rename failure")
            await rename(source, destination)
          },
        },
      }),
    ).rejects.toThrow("simulated overlay rename failure")

    expect(restarts).toBe(0)
    expect(JSON.parse(await readFile(paths.modelConfig, "utf8"))).toEqual(previous)
    expect(
      (await readdir(paths.config)).filter((entry) => entry.startsWith(`${basename(paths.modelConfig)}.tmp-`)),
    ).toEqual([])
  })

  test("does not overwrite the migration marker after its first write", async () => {
    const paths = await runtimePaths()
    const input = {
      paths,
      profiles: [profile("current", ["coder"])],
      defaultSelection: undefined,
      presentProfile: (item: ProductProviderProfile) => item,
    }

    await writeProductRuntimeConfig({ ...input, now: () => new Date("2026-08-15T01:02:03.000Z") })
    const first = await readFile(paths.migrationMarker, "utf8")
    await writeProductRuntimeConfig({ ...input, now: () => new Date("2026-08-16T04:05:06.000Z") })

    expect(JSON.parse(first)).toEqual({ schemaVersion: 1, isolatedAt: "2026-08-15T01:02:03.000Z" })
    expect(await readFile(paths.migrationMarker, "utf8")).toBe(first)
  })

  test("writes only allowlisted nonsensitive metadata to the manifest", async () => {
    const paths = await runtimePaths()
    const current = profile("private", ["coder", "reviewer"])

    await writeProductRuntimeConfig({
      paths,
      profiles: [current],
      defaultSelection: { profileID: current.id, modelID: "reviewer" },
      presentProfile: presentation(),
      now: () => new Date("2026-08-15T09:10:11.000Z"),
    })

    const manifest = JSON.parse(await readFile(paths.manifest, "utf8"))
    expect(manifest).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-08-15T09:10:11.000Z",
      runtime: {
        root: paths.root,
        config: paths.config,
        data: paths.data,
        cache: paths.cache,
        state: paths.state,
        database: paths.database,
        modelConfig: paths.modelConfig,
      },
      counts: { profiles: 1, providers: 1, models: 2 },
      selectedModel: `${current.providerID}/reviewer`,
    })
    expect(Object.keys(manifest)).toEqual(["schemaVersion", "generatedAt", "runtime", "counts", "selectedModel"])
    expect(Object.keys(manifest.runtime)).toEqual([
      "root",
      "config",
      "data",
      "cache",
      "state",
      "database",
      "modelConfig",
    ])
    expect(Object.keys(manifest.counts)).toEqual(["profiles", "providers", "models"])
    const serialized = JSON.stringify(manifest)
    ;[
      current.name,
      current.baseURL,
      current.credentialRef,
      "X-Private-Token",
      "private-header-value",
      "/Users/example/private-project",
      "AGENT_PROFILE_PRIVATE_API_KEY",
      "AGENT_PROFILE_PRIVATE_PROXY_BASE_URL",
      "proxy-bearer-token",
    ].forEach((value) => expect(serialized).not.toContain(value))
  })
})

async function runtimePaths() {
  const directory = await mkdtemp(join(tmpdir(), "guai-code-runtime-config-"))
  temporaryDirectories.push(directory)
  const paths = createDesktopRuntimePaths(join(directory, "user-data"))
  await ensureDesktopRuntime(paths)
  return paths
}

function profile(id: string, models: readonly string[]): ProductProviderProfile {
  return Object.freeze({
    id,
    providerID: `agent-profile-${id}`,
    name: `Private ${id}`,
    kind: "openai-compatible",
    baseURL: `https://${id}.models.example.test/v1`,
    credentialRef: `model-profile:${id}`,
    hasApiKey: true,
    headers: Object.freeze([
      Object.freeze({ name: "X-Tenant", value: "/Users/example/private-project", sensitive: false, hasValue: true }),
      Object.freeze({ name: "X-Private-Token", value: "private-header-value", sensitive: true, hasValue: true }),
    ]),
    models: Object.freeze(models.map((model) => Object.freeze({ id: model, name: model, source: "manual" as const }))),
    settings: Object.freeze({ contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false as const }),
    createdAt: 1,
    updatedAt: 2,
  })
}

function presentation() {
  return (input: ProductProviderProfile): ProductProviderProfile =>
    Object.freeze({
      ...input,
      runtime: Object.freeze({
        baseURL: `http://127.0.0.1:3210/model-profile/${input.id}`,
        credentialProxy: true as const,
      }),
    })
}

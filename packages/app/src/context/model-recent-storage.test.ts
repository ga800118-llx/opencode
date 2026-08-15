import { describe, expect, test } from "bun:test"
import { ServerScope } from "@/utils/server-scope"
import { mergeLegacyRecentModels, recentModelTarget } from "./model-recent-storage"

describe("recentModelTarget", () => {
  test("isolates recents across servers and directories", () => {
    const remote = "https://remote.example" as ServerScope
    expect(recentModelTarget(ServerScope.local, "/first")).not.toEqual(recentModelTarget(ServerScope.local, "/second"))
    expect(recentModelTarget(ServerScope.local, "/first")).not.toEqual(recentModelTarget(remote, "/first"))
    expect(recentModelTarget(ServerScope.local, undefined)).not.toEqual(recentModelTarget(remote, undefined))
    expect(recentModelTarget(ServerScope.local, undefined)).not.toEqual(recentModelTarget(ServerScope.local, "/first"))
  })
})

test("legacy migration preserves scoped order and adopts legacy entries without mutation", () => {
  const scoped = [{ providerID: "scoped", modelID: "model" }]
  const legacy = [
    { providerID: "legacy", modelID: "model/with/slash" },
    { providerID: "scoped", modelID: "model" },
  ]

  expect(mergeLegacyRecentModels(scoped, legacy, 5)).toEqual([scoped[0], legacy[0]])
  expect(legacy).toHaveLength(2)
})

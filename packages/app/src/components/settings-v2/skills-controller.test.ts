import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import {
  blockedKey,
  createSkillRefreshQueue,
  filterSkills,
  isPending,
  loadSkillManagement,
  skillPendingKey,
  scopeKey,
  sourceKey,
  statusKey,
} from "./skills-controller"

const decode = Schema.decodeUnknownSync(Skill.ManagementInfo)

const items = [
  decode({
    id: "project-deploy",
    name: "deploy",
    description: "Deploy the current release",
    location: "/repo/.opencode/skills/deploy/SKILL.md",
    source: { type: "directory", scope: "project", value: "/repo/.opencode/skills" },
    status: "active",
    enabled: true,
    deletable: true,
    deleteTarget: "/repo/.opencode/skills/deploy",
  }),
  decode({
    id: "global-review",
    name: "review",
    description: "Review a change",
    location: "/repo/.opencode/skills/review/SKILL.md",
    source: { type: "directory", scope: "global", value: "/Users/test/.config/opencode/skills" },
    status: "disabled",
    enabled: false,
    deletable: false,
    deleteBlocked: "unsafe",
  }),
  decode({
    id: "builtin-plan",
    name: "plan",
    description: "Build an implementation plan",
    location: "/embedded/plan/SKILL.md",
    source: { type: "builtin", scope: "global", value: "builtin" },
    status: "shadowed",
    enabled: true,
    deletable: false,
    deleteBlocked: "builtin",
  }),
  decode({
    id: "remote-docs",
    name: "docs",
    location: "/cache/skills/docs/SKILL.md",
    source: { type: "url", scope: "project", value: "https://example.com/docs/SKILL.md" },
    status: "active",
    enabled: true,
    deletable: false,
    deleteBlocked: "remote",
  }),
  decode({
    id: "plugin-release",
    name: "release",
    location: "/plugins/release/SKILL.md",
    source: { type: "plugin", scope: "global", value: "release-plugin" },
    status: "active",
    enabled: true,
    deletable: false,
    deleteBlocked: "plugin",
  }),
  decode({
    id: "external-browser",
    name: "agent-browser",
    location: "/Users/test/.agents/skills/agent-browser/SKILL.md",
    source: { type: "external", scope: "global", value: "/Users/test/.agents/skills" },
    status: "active",
    enabled: true,
    deletable: false,
    deleteBlocked: "shared",
  }),
]

describe("Skill settings controller", () => {
  test("retries transient empty Skill snapshots with bounded delays", async () => {
    const delays: number[] = []
    let calls = 0
    const result = await loadSkillManagement(
      async () => (++calls === 1 ? [] : [items[0]!]),
      async (milliseconds) => {
        delays.push(milliseconds)
      },
    )

    expect(result).toEqual([items[0]!])
    expect(calls).toBe(2)
    expect(delays).toEqual([100])
  })

  test("returns a non-empty first Skill snapshot without waiting", async () => {
    const delays: number[] = []
    let calls = 0
    const result = await loadSkillManagement(
      async () => {
        calls++
        return [items[0]!]
      },
      async (milliseconds) => {
        delays.push(milliseconds)
      },
    )

    expect(result).toEqual([items[0]!])
    expect(calls).toBe(1)
    expect(delays).toEqual([])
  })

  test("accepts an empty Skill snapshot after three attempts", async () => {
    const delays: number[] = []
    let calls = 0
    const result = await loadSkillManagement(
      async () => {
        calls++
        return []
      },
      async (milliseconds) => {
        delays.push(milliseconds)
      },
    )

    expect(result).toEqual([])
    expect(calls).toBe(3)
    expect(delays).toEqual([100, 200])
  })

  test("does not retry a Skill request error", async () => {
    const failure = new Error("request failed")
    let calls = 0
    const request = loadSkillManagement(async () => {
      calls++
      throw failure
    })

    await expect(request).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  test("filters by searchable fields and normalized status", () => {
    expect(filterSkills(items, { query: " deploy ", status: "all" }).map((item) => item.name)).toEqual(["deploy"])
    expect(filterSkills(items, { query: "/REPO/.OPENCODE", status: "all" }).map((item) => item.name)).toEqual([
      "deploy",
      "review",
    ])
    expect(filterSkills(items, { query: "example.com", status: "all" }).map((item) => item.name)).toEqual(["docs"])
    expect(filterSkills(items, { query: "implementation plan", status: "all" }).map((item) => item.name)).toEqual([
      "plan",
    ])
    expect(filterSkills(items, { query: "", status: "disabled" }).every((item) => item.status === "disabled")).toBe(
      true,
    )
  })

  test("maps project, global, built-in, remote, plugin, and shared presentation keys", () => {
    expect(sourceKey(items[0]!)).toBe("settings.skills.source.project")
    expect(sourceKey(items[1]!)).toBe("settings.skills.source.global")
    expect(sourceKey(items[2]!)).toBe("settings.skills.source.builtin")
    expect(sourceKey(items[3]!)).toBe("settings.skills.source.remote")
    expect(sourceKey(items[4]!)).toBe("settings.skills.source.plugin")
    expect(sourceKey(items[5]!)).toBe("settings.skills.source.external")
    expect(scopeKey(items[0]!)).toBe("settings.skills.scope.project")
    expect(scopeKey(items[1]!)).toBe("settings.skills.scope.global")
    expect(statusKey(items[0]!)).toBe("settings.skills.status.active")
    expect(statusKey(items[1]!)).toBe("settings.skills.status.disabled")
    expect(statusKey(items[2]!)).toBe("settings.skills.status.shadowed")
    expect(blockedKey(items[0]!)).toBeUndefined()
    expect(blockedKey(items[1]!)).toBe("settings.skills.deleteBlocked.unsafe")
    expect(blockedKey(items[2]!)).toBe("settings.skills.deleteBlocked.builtin")
    expect(blockedKey(items[3]!)).toBe("settings.skills.deleteBlocked.remote")
    expect(blockedKey(items[4]!)).toBe("settings.skills.deleteBlocked.plugin")
    expect(blockedKey(items[5]!)).toBe("settings.skills.deleteBlocked.shared")
  })

  test("tracks one or multiple pending installations independently", () => {
    const keys = items.map((item) => skillPendingKey("server-a", "/repo", item.id))
    const one = new Set([keys[1]!])
    const concurrent = new Set([keys[1]!, keys[3]!])
    expect(keys.map((key) => isPending(one, key))).toEqual([false, true, false, false, false, false])
    expect(keys.map((key) => isPending(concurrent, key))).toEqual([false, true, false, true, false, false])
    expect(keys.every((key) => !isPending(new Set(), key))).toBe(true)
    expect(skillPendingKey("server-a", "/repo", items[0]!.id)).not.toBe(
      skillPendingKey("server-b", "/repo", items[0]!.id),
    )
    expect(skillPendingKey("server-a", "/repo", items[0]!.id)).not.toBe(
      skillPendingKey("server-a", "/other", items[0]!.id),
    )
  })

  test("serializes concurrent cache refreshes in mutation completion order", async () => {
    const calls: string[] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const refresh = createSkillRefreshQueue(async (key: string) => {
      calls.push(key)
      if (key === "first") await gate
    })

    const first = refresh("first")
    const second = refresh("second")
    await Promise.resolve()
    expect(calls).toEqual(["first"])
    release()
    await Promise.all([first, second])
    expect(calls).toEqual(["first", "second"])
  })
})

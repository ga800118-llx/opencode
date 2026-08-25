import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import {
  blockedKey,
  createSkillManagementLoader,
  createSkillRefreshLifecycle,
  createSkillRefreshQueue,
  filterSkills,
  isPending,
  loadSkillManagement,
  mergeDeviceSkills,
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

  test("limits empty-list backoff to the first successful snapshot for each query", async () => {
    const delays: number[] = []
    const calls = { value: 0 }
    const load = createSkillManagementLoader(async (milliseconds) => {
      delays.push(milliseconds)
    })
    const empty = async () => {
      calls.value++
      return []
    }

    expect(await load("scope:/repo", empty)).toEqual([])
    expect(calls.value).toBe(3)
    expect(await load("scope:/repo", empty)).toEqual([])
    expect(calls.value).toBe(4)
    expect(await load("scope:/other", empty)).toEqual([])
    expect(calls.value).toBe(7)
    expect(delays).toEqual([100, 200, 100, 200])
  })

  test("keeps cold-start backoff available until a request succeeds", async () => {
    const failure = new Error("offline")
    const calls = { value: 0 }
    const load = createSkillManagementLoader(async () => undefined)

    await expect(
      load("scope:/repo", async () => {
        calls.value++
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(await load("scope:/repo", async () => (++calls.value === 3 ? [items[0]!] : []))).toEqual([items[0]!])
    expect(calls.value).toBe(3)
  })

  test("refreshes on mount, focus, visibility, and each visible interval, then disposes", async () => {
    const clock = fakeRefreshClock()
    const calls: string[] = []
    const lifecycle = createSkillRefreshLifecycle({
      refresh: () => calls.push("refresh"),
      visible: () => clock.visible.value,
      onFocus: clock.onFocus,
      onVisibilityChange: clock.onVisibilityChange,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    await settle()
    expect(calls).toHaveLength(1)
    clock.advance(1_999)
    await settle()
    expect(calls).toHaveLength(1)
    clock.advance(1)
    await settle()
    expect(calls).toHaveLength(2)
    clock.focus()
    await settle()
    expect(calls).toHaveLength(3)

    clock.visible.value = false
    clock.visibilityChange()
    clock.advance(4_000)
    clock.focus()
    await settle()
    expect(calls).toHaveLength(3)
    expect(clock.pending()).toBe(0)

    clock.visible.value = true
    clock.visibilityChange()
    await settle()
    expect(calls).toHaveLength(4)
    expect(clock.pending()).toBe(1)
    lifecycle.dispose()
    lifecycle.dispose()
    clock.advance(4_000)
    clock.focus()
    clock.visibilityChange()
    await settle()
    expect(calls).toHaveLength(4)
    expect(clock.pending()).toBe(0)
  })

  test("coalesces overlapping lifecycle triggers and continues after refresh failure", async () => {
    const clock = fakeRefreshClock()
    const first = Promise.withResolvers<void>()
    const calls = { value: 0 }
    const lifecycle = createSkillRefreshLifecycle({
      refresh: () => {
        calls.value++
        if (calls.value === 1) return first.promise
        if (calls.value === 2) return Promise.reject(new Error("background failure"))
        return Promise.resolve()
      },
      visible: () => clock.visible.value,
      onFocus: clock.onFocus,
      onVisibilityChange: clock.onVisibilityChange,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    await settle()
    clock.focus()
    clock.advance(2_000)
    await settle()
    expect(calls.value).toBe(1)
    first.resolve()
    await settle()
    expect(calls.value).toBe(2)
    clock.advance(2_000)
    await settle()
    expect(calls.value).toBe(3)
    lifecycle.dispose()
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

  test("deduplicates repeated installations and groups distinct installations by Skill name", () => {
    const first = decode({
      id: "project-device-first",
      name: "device-skill",
      description: "First project copy",
      location: "/one/.opencode/skills/device-skill/SKILL.md",
      source: { type: "directory", scope: "project", value: "/one/.opencode/skills" },
      status: "shadowed",
      enabled: true,
      deletable: true,
      deleteTarget: "/one/.opencode/skills/device-skill",
    })
    const second = decode({
      id: "project-device-second",
      name: "device-skill",
      description: "Second project copy",
      location: "/two/.opencode/skills/device-skill/SKILL.md",
      source: { type: "directory", scope: "project", value: "/two/.opencode/skills" },
      status: "active",
      enabled: true,
      deletable: true,
      deleteTarget: "/two/.opencode/skills/device-skill",
    })
    const result = mergeDeviceSkills([
      { directory: "/one", items: [items[5]!, first] },
      { directory: "/two", items: [items[5]!, second] },
    ])

    expect(result).toHaveLength(2)
    expect(result.filter((item) => item.name === "agent-browser")).toHaveLength(1)
    const grouped = result.find((item) => item.name === "device-skill")!
    expect(grouped.description).toBe("Second project copy")
    expect(grouped.status).toBe("active")
    expect(grouped.enabled).toBe(true)
    expect(grouped.deletable).toBe(false)
    expect(grouped.installations?.map((installation) => installation.directory)).toEqual(["/one", "/two"])
  })

  test("keeps a single-location installation unchanged", () => {
    expect(mergeDeviceSkills([{ directory: "/repo", items: [items[0]!] }])[0]).toBe(items[0])
  })

  test("searches metadata from every installation in a merged row", () => {
    const secondary = decode({
      ...items[0]!,
      id: "project-deploy-secondary",
      location: "/secondary/device-only/SKILL.md",
      source: { type: "directory", scope: "project", value: "/secondary/device-only" },
    })
    const grouped = mergeDeviceSkills([
      { directory: "/repo", items: [items[0]!] },
      { directory: "/secondary", items: [secondary] },
    ])

    expect(filterSkills(grouped, { query: "device-only", status: "all" }).map((item) => item.name)).toEqual([
      "deploy",
    ])
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

function fakeRefreshClock() {
  const state = { now: 0, sequence: 0 }
  const visible = { value: true }
  const timers = new Map<number, { at: number; listener: () => void }>()
  const focusListeners = new Set<() => void>()
  const visibilityListeners = new Set<() => void>()
  const listen = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    visible,
    onFocus: listen(focusListeners),
    onVisibilityChange: listen(visibilityListeners),
    setTimer: (listener: () => void, milliseconds: number) => {
      const id = ++state.sequence
      timers.set(id, { at: state.now + milliseconds, listener })
      return id
    },
    clearTimer: (id: number) => timers.delete(id),
    focus: () => focusListeners.forEach((listener) => listener()),
    visibilityChange: () => visibilityListeners.forEach((listener) => listener()),
    pending: () => timers.size,
    advance: (milliseconds: number) => {
      state.now += milliseconds
      Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= state.now)
        .toSorted((left, right) => left[1].at - right[1].at)
        .forEach(([id, timer]) => {
          if (!timers.delete(id)) return
          timer.listener()
        })
    },
  }
}

async function settle() {
  await Array.from({ length: 8 }, () => undefined).reduce<Promise<void>>(
    (promise) => promise.then(() => undefined),
    Promise.resolve(),
  )
}

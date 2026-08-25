import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import type { SessionTab } from "@/context/tabs"
import { settingsDirectory, settingsModelDirectory, settingsSkillDirectories } from "./settings-directory"

describe("settingsDirectory", () => {
  test("resolves direct project routes", () => {
    expect(
      settingsDirectory(
        { type: "dir-new-sesssion", dir: "/repo", dirBase64: "repo" },
        [],
        () => undefined,
      ),
    ).toBe("/repo")
  })

  test("resolves draft routes from the tab snapshot", () => {
    expect(
      settingsDirectory(
        { type: "draft", draftID: "draft-1" },
        [{ type: "draft", draftID: "draft-1", directory: "/draft", server: ServerConnection.Key.make("local") }],
        () => undefined,
      ),
    ).toBe("/draft")
  })

  test("resolves session routes from synchronized sessions", () => {
    expect(settingsDirectory({ type: "session", sessionId: "session-1" }, [], () => ({ directory: "/session" }))).toBe(
      "/session",
    )
  })

  test("falls back to persisted session tab metadata", () => {
    const tab: SessionTab = {
      type: "session",
      sessionId: "session-1",
      server: ServerConnection.Key.make("local"),
    }
    expect(
      settingsDirectory(
        { type: "session", sessionId: "session-1", server: tab.server },
        [tab],
        () => undefined,
        (item) => (item === tab ? { directory: "/remembered" } : undefined),
      ),
    ).toBe("/remembered")
  })

  test("leaves home and unavailable routes without a directory", () => {
    expect(settingsDirectory({ type: "home" }, [], () => undefined)).toBeUndefined()
    expect(settingsDirectory({ type: "draft", draftID: "missing" }, [], () => undefined)).toBeUndefined()
    expect(settingsDirectory({ type: "session", sessionId: "missing" }, [], () => undefined)).toBeUndefined()
  })
})

describe("settingsSkillDirectories", () => {
  test("collects active, recent, known project, and global locations in order", () => {
    expect(
      settingsSkillDirectories(
        "/active",
        "/recent",
        [{ worktree: "/first" }, { worktree: "/second" }],
        "/home/test/.config/opencode",
      ),
    ).toEqual(["/active", "/recent", "/first", "/second", "/home/test/.config/opencode"])
  })

  test("uses recent and known projects from Home", () => {
    expect(
      settingsSkillDirectories(
        undefined,
        "/recent",
        [{ worktree: "/first" }, { worktree: "/recent" }],
        "/home/test/.config/opencode",
      ),
    ).toEqual(["/recent", "/first", "/home/test/.config/opencode"])
  })

  test("falls back to the global config directory without projects", () => {
    expect(settingsSkillDirectories(undefined, undefined, [], "/home/test/.config/opencode")).toEqual([
      "/home/test/.config/opencode",
    ])
  })

  test("normalizes trailing separators when removing duplicate locations", () => {
    expect(
      settingsSkillDirectories("/repo/", "/repo", [{ worktree: "/repo//" }, { worktree: "/other" }], undefined),
    ).toEqual(["/repo/", "/other"])
  })
})

describe("settingsModelDirectory", () => {
  test("prefers the active task directory", () => {
    expect(settingsModelDirectory("/active", "/recent", [{ worktree: "/first" }])).toBe("/active")
  })

  test("uses the recent project from Home", () => {
    expect(settingsModelDirectory(undefined, "/recent", [{ worktree: "/first" }])).toBe("/recent")
  })

  test("falls back to the first project", () => {
    expect(settingsModelDirectory(undefined, undefined, [{ worktree: "/first" }])).toBe("/first")
  })

  test("leaves model scope global when no project exists", () => {
    expect(settingsModelDirectory(undefined, undefined, [])).toBeUndefined()
  })
})

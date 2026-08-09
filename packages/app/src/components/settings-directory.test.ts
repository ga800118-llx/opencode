import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import type { SessionTab } from "@/context/tabs"
import { settingsDirectory, settingsSkillDirectory } from "./settings-directory"

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

describe("settingsSkillDirectory", () => {
  test("prefers the active project directory", () => {
    expect(settingsSkillDirectory("/repo", "/home/test/.config/opencode")).toBe("/repo")
  })

  test("uses the global config directory from Home", () => {
    expect(settingsSkillDirectory(undefined, "/home/test/.config/opencode")).toBe("/home/test/.config/opencode")
  })
})

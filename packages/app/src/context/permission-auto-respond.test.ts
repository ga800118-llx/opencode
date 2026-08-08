import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import {
  acceptKey,
  autoRespondsPermission,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  modeAutoRespondsPermission,
  normalizeAcceptKeys,
  sessionAutoAccept,
} from "./permission-auto-respond"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("permission storage keys", () => {
  test("normalizes trailing slashes and Windows separators", () => {
    expect(directoryAcceptKey("/repo/")).toBe(directoryAcceptKey("/repo"))
    expect(acceptKey("session", "C:\\repo\\")).toBe(acceptKey("session", "C:/repo"))
  })

  test("migrates legacy directory keys and lets canonical values win", () => {
    const legacy = `${base64Encode("/repo/")}/*`
    const canonical = directoryAcceptKey("/repo")

    expect(normalizeAcceptKeys({ [legacy]: true })).toEqual({ [canonical]: true })
    expect(normalizeAcceptKeys({ [legacy]: true, [canonical]: false })).toEqual({ [canonical]: false })
  })
})

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("defaults to requiring approval when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), "/tmp/project")).toBe(false)
  })

  test("inherits a parent session's false override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
      [`${base64Encode(directory)}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("falls back to directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(true)
    expect(sessionAutoAccept(autoAccept, sessions, permission("root"), directory)).toBeUndefined()
  })

  test("session-level override takes precedence over directory-level", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(false)
  })

  test("parent false override takes precedence over directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("parent true override takes precedence over disabled directory fallback", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: false,
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })
})

describe("isDirectoryAutoAccepting", () => {
  test("returns true when directory key is set", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(true)
  })

  test("returns false when directory key is not set", () => {
    expect(isDirectoryAutoAccepting({}, "/tmp/project")).toBe(false)
  })

  test("returns false when directory key is explicitly false", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: false }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(false)
  })

  test("reads a legacy equivalent directory key before persistence migration", () => {
    const autoAccept = { [`${base64Encode("/tmp/project/")}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, "/tmp/project")).toBe(true)
  })
})

describe("modeAutoRespondsPermission", () => {
  test("does not inherit a parent runtime override into an existing task", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(modeAutoRespondsPermission({ root: "auto" }, sessions, permission("child"))).toBe(false)
  })

  test("does not respond for standard or restricted tasks", () => {
    const sessions = [session({ id: "standard" }), session({ id: "restricted" })]

    expect(modeAutoRespondsPermission({ standard: "standard" }, sessions, permission("standard"))).toBe(false)
    expect(modeAutoRespondsPermission({ restricted: "restricted" }, sessions, permission("restricted"))).toBe(false)
  })

  test("prefers an explicit child mode over the parent", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(modeAutoRespondsPermission({ root: "auto", child: "standard" }, sessions, permission("child"))).toBe(false)
  })

  test("uses server session modes when no runtime override exists", () => {
    const sessions = [
      { ...session({ id: "root" }), permissionMode: "auto" as const },
      { ...session({ id: "child", parentID: "root" }), permissionMode: "auto" as const },
    ]

    expect(modeAutoRespondsPermission({}, sessions, permission("child"))).toBe(true)
  })

  test("treats a known child without a stored mode as effective standard", () => {
    const sessions = [
      { ...session({ id: "root" }), permissionMode: "auto" as const },
      session({ id: "child", parentID: "root" }),
    ]

    expect(modeAutoRespondsPermission({}, sessions, permission("child"))).toBe(false)
  })

  test("defaults old V2 tasks without a mode to standard", () => {
    expect(modeAutoRespondsPermission({}, [session({ id: "root" })], permission("root"))).toBe(false)
  })
})

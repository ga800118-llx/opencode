import { describe, expect, test } from "bun:test"
import { projectActivity } from "./activity-watchdog"

describe("activity watchdog", () => {
  test.each([
    [{ working: false, now: 1_000, lastActivityAt: 0, toolRunning: false }, "idle"],
    [{ working: true, now: 179_999, lastActivityAt: 0, toolRunning: false }, "active"],
    [{ working: true, now: 180_000, lastActivityAt: 0, toolRunning: false }, "slow"],
    [{ working: true, now: 599_999, lastActivityAt: 0, toolRunning: false }, "slow"],
    [{ working: true, now: 600_000, lastActivityAt: 0, toolRunning: false }, "unverified"],
  ] as const)("projects %o as %s", (input, expected) => {
    expect(projectActivity(input)).toBe(expected)
  })

  test("keeps a known running tool active for eight hours", () => {
    expect(
      projectActivity({
        working: true,
        now: 8 * 60 * 60_000,
        lastActivityAt: 0,
        toolRunning: true,
      }),
    ).toBe("active")
  })

  test("does not treat a future timestamp as idle time", () => {
    expect(projectActivity({ working: true, now: 1_000, lastActivityAt: 2_000, toolRunning: false })).toBe("active")
  })
})

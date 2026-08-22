import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@opencode-ai/sdk/v2"
import {
  calculateTurnDuration,
  isTimelineReady,
  loadOlderTimeline,
  selectUserMessages,
  selectVisibleUserMessages,
} from "./model"

const user = (id: string) => ({ id, role: "user" }) as UserMessage
const assistant = (id: string) => ({ id, role: "assistant" }) as AssistantMessage

describe("timeline model", () => {
  test("keeps a working turn moving past intermediate assistant completions", () => {
    expect(
      calculateTurnDuration({
        created: 1_000,
        completed: [3_000],
        working: true,
        now: 9_000,
      }),
    ).toBe(8_000)
  })

  test("freezes an idle turn at the latest assistant completion", () => {
    expect(
      calculateTurnDuration({
        created: 1_000,
        completed: [3_000, undefined, 7_000],
        working: false,
        now: 9_000,
      }),
    ).toBe(6_000)
  })

  test("ignores invalid idle completion timestamps", () => {
    expect(calculateTurnDuration({ created: 2_000, completed: [], working: false, now: 9_000 })).toBeUndefined()
    expect(calculateTurnDuration({ created: 2_000, completed: [1_000], working: false, now: 9_000 })).toBeUndefined()
  })

  test("selects users and applies the revert boundary", () => {
    const messages: Message[] = [user("msg_1"), assistant("msg_2"), user("msg_3"), user("msg_5")]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_1", "msg_3", "msg_5"])
    expect(selectVisibleUserMessages(users, "msg_5").map((message) => message.id)).toEqual(["msg_1", "msg_3"])
    expect(selectVisibleUserMessages(users)).toBe(users)
  })

  test("waits for an assistant-only load to hydrate its user root", () => {
    expect(isTimelineReady([assistant("msg_2")], true)).toBe(false)
    expect(isTimelineReady([user("msg_1"), assistant("msg_2")], true)).toBe(true)
    expect(isTimelineReady([], false)).toBe(true)
  })

  test("loads exactly one opaque cursor page", async () => {
    let calls = 0
    const anchors: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
      before: () => anchors.push("before"),
      after: (done) => anchors.push("after", done),
    })

    expect(calls).toBe(1)
    expect(anchors).toEqual(["before", "after", true])
  })

  test("stops when a page adds no raw messages", async () => {
    let calls = 0
    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })

  test("does not restore an anchor after the session changes", async () => {
    let sessionID = "ses_old"
    let restore = 0

    await loadOlderTimeline({
      sessionID: () => sessionID,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        sessionID = "ses_new"
      },
      after: () => {
        restore += 1
      },
    })

    expect(restore).toBe(0)
  })

  test("releases the anchor when loading history fails", async () => {
    let restore = 0

    await expect(
      loadOlderTimeline({
        sessionID: () => "ses_test",
        more: () => true,
        loading: () => false,
        loadMore: async () => {
          throw new Error("history failed")
        },
        after: () => {
          restore += 1
        },
      }),
    ).rejects.toThrow("history failed")

    expect(restore).toBe(1)
  })
})

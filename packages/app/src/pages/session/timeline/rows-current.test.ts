import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { normalizeSessionMessages } from "@/utils/session-message"

mock.module("@opencode-ai/session-ui/message-part", () => ({
  renderable: (part: { type: string }, showReasoning = true) => part.type !== "reasoning" || showReasoning,
  groupParts: (refs: Array<{ messageID: string; part: { id: string } }>) =>
    refs.map((ref) => ({
      type: "part" as const,
      key: ref.part.id,
      ref: { messageID: ref.messageID, partID: ref.part.id },
    })),
}))

const { Timeline, TimelineRow } = await import("./rows")

describe("current session timeline rows", () => {
  test("collects assistant process items before the trailing final answer", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "reasoning", text: "thinking" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "note.txt" },
              metadata: { title: "note.txt" },
              content: [{ type: "text", text: "hello" }],
            },
            time: { created: 2, ran: 3, completed: 4 },
          },
          { type: "text", text: "final answer" },
        ],
        time: { created: 2, completed: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_assistant:text:0",
    ])
    expect(result.rows[1]).toMatchObject({
      _tag: "AssistantProcess",
      items: [
        { type: "part", group: { key: "msg_assistant:reasoning:0" } },
        { type: "part", group: { key: "call_1" } },
      ],
    })
  })

  test("keeps a process disclosure for a text-only answer", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "final answer" }],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_assistant:text:0",
    ])
    expect(result.rows[1]).toMatchObject({ _tag: "AssistantProcess", items: [] })
  })

  test("keeps an interrupted final answer outside the process disclosure", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer before interruption" }],
        error: { type: "request_aborted", message: "Stopped" },
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_assistant:text:0",
    ])
    expect(result.rows[1]).toMatchObject({
      _tag: "AssistantProcess",
      items: [{ type: "interrupted" }],
    })
  })

  test("treats interrupted text as process content when a later answer replaces it", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "partial answer" }],
        error: { type: "request_aborted", message: "Stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_replacement",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "replacement answer" }],
        time: { created: 4, completed: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_replacement:text:0",
    ])
    expect(result.rows[1]).toMatchObject({
      _tag: "AssistantProcess",
      items: [{ type: "part", group: { key: "msg_interrupted:text:0" } }, { type: "interrupted" }],
    })
  })

  test("uses only content after the last of multiple interruptions as the final answer", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_first_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "first partial answer" }],
        error: { type: "request_aborted", message: "Stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_second_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "second partial answer" }],
        error: { type: "request_aborted", message: "Stopped again" },
        time: { created: 4, completed: 5 },
      },
      {
        id: "msg_final",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "final answer" }],
        time: { created: 6, completed: 7 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_final:text:0",
    ])
    expect(result.rows[1]).toMatchObject({
      _tag: "AssistantProcess",
      items: [
        { type: "part", group: { key: "msg_first_interrupted:text:0" } },
        { type: "interrupted" },
        { type: "part", group: { key: "msg_second_interrupted:text:0" } },
        { type: "interrupted" },
      ],
    })
  })

  test("does not restore interrupted text while an empty continuation message is pending", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "replaced partial answer" }],
        error: { type: "request_aborted", message: "Stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_continuation",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-activity:msg_user",
    ])
    expect(result.rows.at(-1)).toMatchObject({ _tag: "AssistantActivity", tool: undefined })
    expect(result.rows[1]).toMatchObject({
      _tag: "AssistantProcess",
      items: [{ type: "part", group: { key: "msg_interrupted:text:0" } }, { type: "interrupted" }],
    })
  })

  test("suppresses interruption markers for compacted turns using the projected user part", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "partial answer" },
        ],
        error: { type: "request_aborted", message: "Stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_compaction",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "turn-divider:msg_user:compaction",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_interrupted:text:0",
    ])
    expect(result.rows[2]).toMatchObject({
      _tag: "AssistantProcess",
      items: [{ type: "part", group: { key: "msg_interrupted:reasoning:0" } }],
    })
  })

  test("keeps the last interrupted text visible when multiple interruptions have no continuation", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_first_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "replaced partial answer" }],
        error: { type: "request_aborted", message: "Stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_last_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "reasoning", text: "last attempt reasoning" },
          { type: "text", text: "last interrupted answer" },
        ],
        error: { type: "request_aborted", message: "Stopped again" },
        time: { created: 4, completed: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_last_interrupted:text:0",
    ])
    expect(result.rows[1]).toMatchObject({
      _tag: "AssistantProcess",
      items: [
        { type: "part", group: { key: "msg_first_interrupted:text:0" } },
        { type: "interrupted" },
        { type: "part", group: { key: "msg_last_interrupted:reasoning:0" } },
        { type: "interrupted" },
      ],
    })
  })

  test("adds one live activity row after busy hidden-reasoning process content", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "reasoning", text: "thinking" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "note.txt" },
              metadata: { title: "note.txt" },
              content: [{ type: "text", text: "hello" }],
            },
            time: { created: 2, ran: 3, completed: 4 },
          },
        ],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      false,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-activity:msg_user",
    ])
    expect(result.rows.at(-1)).toMatchObject({ _tag: "AssistantActivity", tool: undefined })
  })

  test("derives turns and tagged rows from chronological current messages", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer" }],
        time: { created: 2, completed: 3 },
      },
      { id: "msg_3", type: "user", text: "second", time: { created: 4 } },
      {
        id: "msg_4",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "reasoning", text: "working" }],
        time: { created: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.activeMessageID).toBe("msg_3")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-process:msg_1",
      "assistant-part:msg_1:msg_2:text:0",
      "turn-gap:msg_3",
      "user-message:msg_3",
      "assistant-process:msg_3",
      "assistant-activity:msg_3",
    ])
  })

  test("renders a current shell message as a standalone turn", () => {
    const source = [
      {
        id: "msg_shell",
        type: "shell",
        shellID: "shell_1",
        command: "pwd",
        status: "exited",
        exit: 0,
        output: { output: "/repo", cursor: 5, size: 5, truncated: false },
        time: { created: 1, completed: 2 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.activeMessageID).toBe("msg_shell")
    expect(result.rows.map(TimelineRow.key)).toEqual(["user-message:msg_shell", "assistant-process:msg_shell"])
  })

  test("keeps the elapsed process row before the live activity row while waiting for content", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-activity:msg_user",
    ])
    expect(result.rows[1]).toMatchObject({ _tag: "AssistantProcess", items: [] })
  })

  test("keeps one live activity row after a streaming answer and removes it when idle", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "streaming answer" }],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))
    const construct = (status: "busy" | "idle") =>
      Timeline.constructSessionMessageRows(
        source,
        (messageID) => messages.get(messageID),
        (messageID) => normalized.parts.get(messageID) ?? [],
        true,
        status,
        true,
        normalized.messages.filter((message) => message.role === "user"),
      )

    const busy = construct("busy")
    expect(busy.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_assistant:text:0",
      "assistant-activity:msg_user",
    ])
    expect(busy.rows.at(-1)).toMatchObject({ _tag: "AssistantActivity", userMessageID: "msg_user" })

    expect(construct("idle").rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_assistant:text:0",
    ])
  })

  test("reports only the most recent pending or running tool in the live activity row", () => {
    const source = [
      { id: "msg_user", type: "user", text: "question", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_shell",
            name: "shell",
            state: { status: "running", input: {}, metadata: {} },
            time: { created: 2, ran: 3 },
          },
          {
            type: "tool",
            id: "call_todowrite",
            name: "todowrite",
            state: { status: "running", input: {}, metadata: {} },
            time: { created: 4, ran: 5 },
          },
          { type: "text", text: "continuing answer" },
        ],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-process:msg_user",
      "assistant-part:msg_user:msg_assistant:text:0",
      "assistant-activity:msg_user",
    ])
    expect(result.rows.at(-1)).toMatchObject({ _tag: "AssistantActivity", tool: "todowrite" })
  })

  test("keeps a projected parent missing from the source page before newer turns", () => {
    const source = [
      { id: "msg_user_1", type: "user", text: "first question", time: { created: 1 } },
      {
        id: "msg_assistant_1",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "first answer" }],
        time: { created: 2, completed: 3 },
      },
      { id: "msg_user_2", type: "user", text: "second question", time: { created: 4 } },
      {
        id: "msg_assistant_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "second answer" }],
        time: { created: 5, completed: 6 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source.slice(1),
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user_1",
      "assistant-process:msg_user_1",
      "assistant-part:msg_user_1:msg_assistant_1:text:0",
      "turn-gap:msg_user_2",
      "user-message:msg_user_2",
      "assistant-process:msg_user_2",
      "assistant-part:msg_user_2:msg_assistant_2:text:0",
    ])
  })

  test("renders an optimistic user turn and elapsed process row before the protocol message arrives", () => {
    const source = [
      { id: "msg_1", type: "user", text: "existing", time: { created: 1 } },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const optimistic = {
      id: "msg_2",
      sessionID: "ses_1",
      role: "user" as const,
      time: { created: 2 },
      agent: "build",
      model: { modelID: "model", providerID: "provider" },
    }
    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) =>
        messageID === optimistic.id ? optimistic : normalized.messages.find((message) => message.id === messageID),
      () => [],
      true,
      "busy",
      true,
      [...normalized.messages.filter((message) => message.role === "user"), optimistic],
    )

    expect(result.activeMessageID).toBe(optimistic.id)
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "turn-gap:msg_2",
      "user-message:msg_2",
      "assistant-process:msg_2",
      "assistant-activity:msg_2",
    ])
  })
})

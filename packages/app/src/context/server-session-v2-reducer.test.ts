import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { createV2SessionReducer } from "./server-session-v2-reducer"

const event = (input: object) => input as OpenCodeEvent
const base = { created: 1, location: { directory: "/repo" }, durable: { aggregateID: "ses_1", seq: 1, version: 1 } }

describe("v2 session reducer", () => {
  test("projects promoted input and streaming assistant content", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_admitted",
      type: "session.input.admitted",
      data: {
        sessionID: "ses_1",
        inputID: "msg_user",
        input: { type: "user", delivery: "steer", data: { text: "hello" } },
      },
    })
    apply({
      ...base,
      id: "evt_promoted",
      type: "session.input.promoted",
      data: { sessionID: "ses_1", inputID: "msg_user" },
    })
    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_text_start",
      type: "session.text.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0 },
    })
    apply({
      ...base,
      id: "evt_text_delta",
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, delta: "hel" },
    })
    apply({
      ...base,
      id: "evt_text_end",
      type: "session.text.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, text: "hello" },
    })

    expect(messages[0]).toMatchObject({ id: "msg_user", type: "user", text: "hello" })
    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    })
  })

  test("projects native runner streaming and failure events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }
    const native = { location: { directory: "/repo" }, durable: base.durable }

    apply({
      ...native,
      id: "evt_native_step",
      type: "session.next.step.started",
      data: {
        timestamp: 10,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...native,
      id: "evt_native_text_start",
      type: "session.next.text.started",
      data: { timestamp: 11, sessionID: "ses_1", assistantMessageID: "msg_native", textID: "text_1" },
    })
    apply({
      ...native,
      id: "evt_native_text_delta",
      type: "session.next.text.delta",
      data: {
        timestamp: 12,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        textID: "text_1",
        delta: "partial",
      },
    })
    apply({
      ...native,
      id: "evt_native_failed",
      type: "session.next.step.failed",
      data: {
        timestamp: 13,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        error: { type: "unknown", message: "credentials unavailable" },
      },
    })

    expect(messages[0]).toMatchObject({
      id: "msg_native",
      type: "assistant",
      finish: "error",
      error: { message: "credentials unavailable" },
      content: [{ type: "text", text: "partial" }],
      time: { created: 10, completed: 13 },
    })
  })

  test("projects a completed native runner response", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }
    const native = { location: { directory: "/repo" }, durable: base.durable }

    apply({
      ...native,
      id: "evt_native_step",
      type: "session.next.step.started",
      data: {
        timestamp: 20,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...native,
      id: "evt_native_text_start",
      type: "session.next.text.started",
      data: { timestamp: 21, sessionID: "ses_1", assistantMessageID: "msg_native", textID: "text_1" },
    })
    apply({
      ...native,
      id: "evt_native_text_end",
      type: "session.next.text.ended",
      data: {
        timestamp: 22,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        textID: "text_1",
        text: "completed",
      },
    })
    apply({
      ...native,
      id: "evt_native_step_end",
      type: "session.next.step.ended",
      data: {
        timestamp: 23,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })

    expect(messages[0]).toMatchObject({
      id: "msg_native",
      type: "assistant",
      finish: "stop",
      content: [{ type: "text", text: "completed" }],
      time: { created: 20, completed: 23 },
    })
  })

  test("projects native runner tool events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }
    const native = { location: { directory: "/repo" }, durable: base.durable }

    apply({
      ...native,
      id: "evt_native_step",
      type: "session.next.step.started",
      data: {
        timestamp: 30,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...native,
      id: "evt_native_tool_start",
      type: "session.next.tool.input.started",
      data: {
        timestamp: 31,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        callID: "call_1",
        name: "bash",
      },
    })
    apply({
      ...native,
      id: "evt_native_tool_called",
      type: "session.next.tool.called",
      data: {
        timestamp: 32,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        callID: "call_1",
        input: { command: "printf done" },
        provider: { executed: false },
      },
    })
    apply({
      ...native,
      id: "evt_native_tool_success",
      type: "session.next.tool.success",
      data: {
        timestamp: 33,
        sessionID: "ses_1",
        assistantMessageID: "msg_native",
        callID: "call_1",
        structured: { output: "done" },
        content: [{ type: "text", text: "done" }],
        provider: { executed: false },
      },
    })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "call_1",
          state: { status: "completed", input: { command: "printf done" }, content: [{ text: "done" }] },
          time: { created: 31, ran: 32, completed: 33 },
        },
      ],
    })
  })

  test("folds tool, retry, and completion events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_delta",
      type: "session.tool.input.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", delta: "{}" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: {},
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })
    apply({
      ...base,
      id: "evt_retry",
      type: "session.retry.scheduled",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        at: 10,
        error: { type: "ProviderError", message: "retry" },
      },
    })
    apply({ ...base, id: "evt_done", type: "session.execution.succeeded", data: { sessionID: "ses_1" } })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      retry: undefined,
      content: [{ type: "tool", id: "call_1", state: { status: "completed", content: [{ text: "done" }] } }],
    })
  })

  test("requests hydration when promotion admission was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.input.promoted",
        data: { sessionID: "ses_1", inputID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ sessionID: "ses_1", missing: "msg_user", touched: [] })
  })
})

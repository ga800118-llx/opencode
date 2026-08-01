import { describe, expect, test } from "bun:test"
import { normalizeProductEvent, type AdaptedProductEventInput } from "./events"

const envelope = (type: string, properties: Record<string, unknown>): AdaptedProductEventInput => ({
  id: "evt_product_1",
  created: 1_725_000_000_000,
  type,
  properties,
  location: { directory: "/repo" },
})

describe("normalizeProductEvent", () => {
  test("normalizes task lifecycle and preserves event identity", () => {
    expect(
      normalizeProductEvent(
        envelope("session.created", {
          sessionID: "ses_1",
          info: { title: "Inspect repository", directory: "/ignored" },
        }),
      ),
    ).toEqual({
      id: "evt_product_1",
      type: "task.created",
      taskID: "ses_1",
      directory: "/repo",
      time: 1_725_000_000_000,
      data: { title: "Inspect repository" },
    })

    expect(
      normalizeProductEvent(envelope("session.execution.interrupted", { sessionID: "ses_1", reason: "user" })),
    ).toMatchObject({
      type: "task.execution.interrupted",
      taskID: "ses_1",
      data: { reason: "user" },
    })
  })

  test("normalizes status and scheduled retry events", () => {
    expect(
      normalizeProductEvent(
        envelope("session.status", {
          sessionID: "ses_1",
          status: { type: "retry", attempt: 2, next: 1_725_000_001_000 },
        }),
      ),
    ).toMatchObject({
      type: "task.status",
      taskID: "ses_1",
      data: { status: "retry", attempt: 2, next: 1_725_000_001_000 },
    })

    expect(
      normalizeProductEvent(
        envelope("session.retry.scheduled", {
          sessionID: "ses_1",
          attempt: 3,
          at: 1_725_000_002_000,
          error: { message: "provider retry" },
        }),
      ),
    ).toMatchObject({
      type: "task.status",
      data: { status: "retry", attempt: 3, next: 1_725_000_002_000 },
    })
  })

  test("normalizes assistant text and reasoning deltas", () => {
    expect(
      normalizeProductEvent(
        envelope("session.text.delta", {
          sessionID: "ses_1",
          assistantMessageID: "msg_1",
          ordinal: 4,
          delta: "hello",
        }),
      ),
    ).toMatchObject({
      type: "assistant.text.delta",
      taskID: "ses_1",
      data: { messageID: "msg_1", ordinal: 4, delta: "hello" },
    })

    expect(
      normalizeProductEvent(
        envelope("message.part.delta", {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta: "considering",
        }),
      ),
    ).toMatchObject({
      type: "assistant.part.delta",
      data: { messageID: "msg_1", partID: "prt_1", field: "text", delta: "considering" },
    })
  })

  test("keeps step failure non-terminal across retry and success", () => {
    const events = [
      envelope("session.step.failed", {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        error: { code: "ECONNRESET" },
      }),
      envelope("session.retry.scheduled", { sessionID: "ses_1", attempt: 1, at: 1_725_000_001_000 }),
      envelope("session.execution.succeeded", { sessionID: "ses_1" }),
    ].map((event) => normalizeProductEvent(event))

    expect(events.map((event) => event.type)).toEqual([
      "assistant.step.failed",
      "task.status",
      "task.execution.succeeded",
    ])
    expect(events[0]).toMatchObject({ data: { messageID: "msg_1", error: { kind: "unreachable-endpoint" } } })
  })

  test("normalizes SDK next events and legacy part snapshots", () => {
    expect(
      normalizeProductEvent(
        envelope("session.next.reasoning.delta", {
          timestamp: 1_725_000_000_100,
          sessionID: "ses_1",
          assistantMessageID: "msg_1",
          reasoningID: "reasoning_1",
          delta: "considering",
        }),
      ),
    ).toMatchObject({
      type: "assistant.reasoning.delta",
      data: { messageID: "msg_1", partID: "reasoning_1", delta: "considering" },
    })

    expect(
      normalizeProductEvent(
        envelope("message.part.updated", {
          sessionID: "ses_1",
          part: {
            id: "prt_reasoning",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "reasoning",
            text: "complete reasoning",
          },
        }),
      ),
    ).toMatchObject({
      type: "assistant.reasoning.updated",
      data: { messageID: "msg_1", partID: "prt_reasoning", text: "complete reasoning" },
    })

    expect(
      normalizeProductEvent(
        envelope("message.part.updated", {
          sessionID: "ses_1",
          part: {
            id: "prt_tool",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_1",
            tool: "read",
            state: { status: "completed", output: "ignored raw output" },
          },
        }),
      ),
    ).toMatchObject({ type: "tool.succeeded", data: { messageID: "msg_1", callID: "call_1" } })

    expect(
      normalizeProductEvent(
        envelope("session.next.shell.ended", {
          timestamp: 1_725_000_000_200,
          sessionID: "ses_1",
          callID: "call_shell",
          output: "done",
        }),
      ),
    ).toMatchObject({ type: "shell.output", data: { operationID: "call_shell", output: "done" } })
  })

  test("normalizes tool activity without copying provider payloads", () => {
    expect(
      normalizeProductEvent(
        envelope("session.tool.input.started", {
          sessionID: "ses_1",
          assistantMessageID: "msg_1",
          callID: "call_1",
          name: "read",
        }),
      ),
    ).toMatchObject({
      type: "tool.input.started",
      data: { messageID: "msg_1", callID: "call_1", name: "read" },
    })

    const completed = normalizeProductEvent(
      envelope("session.tool.success", {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        callID: "call_1",
        executed: true,
        content: [{ type: "text", text: "token=raw-secret" }],
        metadata: { authorization: "Bearer raw-secret" },
      }),
    )
    expect(completed).toMatchObject({
      type: "tool.succeeded",
      data: { messageID: "msg_1", callID: "call_1", executed: true },
    })
    expect(JSON.stringify(completed)).not.toContain("raw-secret")
  })

  test("normalizes shell and command events", () => {
    expect(
      normalizeProductEvent(
        envelope("session.shell.ended", {
          sessionID: "ses_1",
          shell: { id: "op_1" },
          output: { output: "done", cursor: 4, size: 4, truncated: false },
        }),
      ),
    ).toMatchObject({
      type: "shell.output",
      data: { operationID: "op_1", output: "done", cursor: 4, size: 4, truncated: false },
    })

    expect(
      normalizeProductEvent(
        envelope("command.executed", {
          sessionID: "ses_1",
          name: "review",
          arguments: "--staged",
          messageID: "msg_2",
        }),
      ),
    ).toMatchObject({
      type: "command.output",
      data: { command: "review", arguments: "--staged", messageID: "msg_2" },
    })
  })

  test("normalizes permissions and questions", () => {
    expect(
      normalizeProductEvent(
        envelope("permission.asked", {
          id: "perm_1",
          sessionID: "ses_1",
          permission: "read",
          patterns: ["src/**"],
          always: ["src/**"],
          tool: { messageID: "msg_1", callID: "call_1" },
        }),
      ),
    ).toMatchObject({
      type: "permission.asked",
      data: {
        requestID: "perm_1",
        capability: "read",
        resources: ["src/**"],
        remember: ["src/**"],
        messageID: "msg_1",
        callID: "call_1",
      },
    })

    expect(
      normalizeProductEvent(
        envelope("question.asked", {
          id: "question_1",
          sessionID: "ses_1",
          questions: [
            {
              header: "Mode",
              question: "Choose a mode",
              options: [{ label: "Automatic", description: "Use defaults" }],
              multiple: false,
              custom: true,
            },
          ],
        }),
      ),
    ).toMatchObject({
      type: "question.asked",
      data: { requestID: "question_1", questions: [{ header: "Mode", custom: true }] },
    })
  })

  test("normalizes file, server, and redacted error events", () => {
    expect(
      normalizeProductEvent(envelope("filesystem.changed", { file: "src/index.ts", event: "add" })),
    ).toMatchObject({ type: "file.changed", data: { path: "src/index.ts", change: "add" } })
    expect(normalizeProductEvent(envelope("workspace.status", { workspaceID: "work_1", status: "connected" }))).toMatchObject(
      { type: "server.status", data: { workspaceID: "work_1", status: "connected" } },
    )

    const error = normalizeProductEvent(
      envelope("session.error", {
        sessionID: "ses_1",
        error: {
          name: "APIError",
          data: { statusCode: 401, responseBody: "api_key=raw-secret" },
        },
      }),
    )
    expect(error).toMatchObject({ type: "error", data: { error: { kind: "authentication" } } })
    expect(JSON.stringify(error)).not.toContain("raw-secret")
  })

  test("degrades malformed and unknown events to safe advanced events", () => {
    const result = normalizeProductEvent({
      id: "evt_unknown",
      type: "future.event",
      properties: { sessionID: "ses_1", token: "raw-secret", nested: { authorization: "Bearer raw-secret" } },
      current: { created: 99, location: { directory: "/repo" } },
    })

    expect(result).toEqual({
      id: "evt_unknown",
      type: "advanced",
      taskID: "ses_1",
      directory: "/repo",
      time: 99,
      data: { sourceType: "future.event" },
    })
    expect(JSON.stringify(result)).not.toContain("raw-secret")
    expect(normalizeProductEvent({ type: { unexpected: true }, properties: null })).toEqual({
      type: "advanced",
      data: { sourceType: "unknown" },
    })
  })

  test("bounds question and answer payloads", () => {
    const oversizedQuestions = Array.from({ length: 33 }, (_, index) => ({
      header: `Question ${index}`,
      question: "Choose",
      options: [],
    }))
    expect(
      normalizeProductEvent(
        envelope("question.asked", { id: "question_1", sessionID: "ses_1", questions: oversizedQuestions }),
      ),
    ).toMatchObject({ type: "advanced", data: { sourceType: "question.asked" } })

    const oversizedAnswers = Array.from({ length: 33 }, () => ["answer"])
    expect(
      normalizeProductEvent(
        envelope("question.replied", { requestID: "question_1", sessionID: "ses_1", answers: oversizedAnswers }),
      ),
    ).toMatchObject({ type: "advanced", data: { sourceType: "question.replied" } })
  })

  test("maps a representative event batch within the product overhead budget", () => {
    const fixtures = [
      envelope("session.text.delta", {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        ordinal: 0,
        delta: "a",
      }),
      envelope("session.tool.progress", {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        callID: "call_1",
        metadata: { progress: 0.5 },
      }),
      envelope("filesystem.changed", { file: "src/index.ts", event: "change" }),
      envelope("session.error", { sessionID: "ses_1", error: { code: "ECONNRESET" } }),
    ]
    const batch = Array.from({ length: 4_000 }, (_, index) => fixtures[index % fixtures.length])
    batch.slice(0, 100).forEach((event) => normalizeProductEvent(event))
    const durations = Array.from({ length: 5 }, () => {
      const started = performance.now()
      batch.forEach((event) => normalizeProductEvent(event))
      return performance.now() - started
    }).sort((a, b) => a - b)
    const median = durations[2] ?? Number.POSITIVE_INFINITY

    expect(median).toBeLessThan(200)
  })
})

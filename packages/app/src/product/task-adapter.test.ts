import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import type { CompatibleApi } from "@/utils/server-compat"
import { createProductTaskAdapter } from "./task-adapter"
import type { ProductFilePart, ProductPromptInput } from "./contracts"

const record = {
  id: "session-1",
  projectID: "project-1",
  agent: "build",
  model: { id: "model-1", providerID: "provider-1", variant: "high" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  title: "Task one",
  location: { directory: "/repo" },
} as SessionInfo

function setup() {
  const calls = {
    create: [] as unknown[],
    prompt: [] as unknown[],
    command: [] as unknown[],
    shell: [] as unknown[],
    interrupt: [] as unknown[],
  }
  const api = {
    session: {
      create: async (input: unknown) => {
        calls.create.push(input)
        return record
      },
      prompt: async (input: unknown) => {
        calls.prompt.push(input)
        return {}
      },
      command: async (input: unknown) => {
        calls.command.push(input)
        return {}
      },
      shell: async (input: unknown) => {
        calls.shell.push(input)
      },
      interrupt: async (input: unknown) => {
        calls.interrupt.push(input)
      },
    },
  } as unknown as CompatibleApi
  return {
    calls,
    api,
    adapter: createProductTaskAdapter(api, {
      messageID: () => "msg-generated",
      operationID: () => "evt-generated",
    }),
  }
}

const model = { providerID: "provider-1", modelID: "model-1", variant: "high" }

describe("createProductTaskAdapter", () => {
  test("creates a task without trimming the session record", async () => {
    const { adapter, calls } = setup()

    await expect(adapter.create({ directory: "/repo", agent: "build", model })).resolves.toEqual({
      task: { id: "session-1", directory: "/repo", title: "Task one" },
      record,
    })
    expect(calls.create).toEqual([
      {
        agent: "build",
        model: { id: "model-1", providerID: "provider-1", variant: "high" },
        location: { directory: "/repo" },
      },
    ])
  })

  test("maps ordered prompt parts to legacy and modern transport fields", async () => {
    const { adapter, calls } = setup()
    const parts: ProductPromptInput["parts"] = [
      { id: "part-text", type: "text", text: "Inspect these" },
      {
        id: "part-comment",
        type: "text",
        text: "Review line 3",
        synthetic: true,
        ignored: false,
        time: { start: 10, end: 11 },
        metadata: {
          comment: {
            path: "src/a.ts",
            selection: { startLine: 3, startChar: 0, endLine: 3, endChar: 8 },
            comment: "Review line 3",
            preview: "const a = 1",
            origin: "review",
          },
        },
      },
      {
        id: "part-file",
        type: "file",
        uri: "file:///repo/src/a.ts",
        name: "a.ts",
        mime: "text/plain",
        source: {
          type: "file",
          path: "/repo/src/a.ts",
          text: { value: "@src/a.ts", start: 14, end: 23 },
        },
      },
      {
        id: "part-symbol",
        type: "file",
        uri: "file:///repo/src/b.ts",
        name: "b.ts",
        mime: "text/plain",
        source: {
          type: "symbol",
          path: "/repo/src/b.ts",
          text: { value: "@run", start: 24, end: 28 },
          range: { start: { line: 4, character: 1 }, end: { line: 8, character: 2 } },
          name: "run",
          kind: 12,
        },
      },
      {
        id: "part-resource",
        type: "file",
        uri: "mcp://docs/1",
        name: "docs",
        mime: "text/plain",
        source: {
          type: "resource",
          text: { value: "@docs", start: 29, end: 34 },
          clientName: "docs-mcp",
          uri: "mcp://docs/1",
        },
      },
      { id: "part-agent", type: "agent", name: "planner", mention: { text: "@planner", start: 35, end: 43 } },
    ]

    await expect(
      adapter.prompt({ taskID: "session-1", directory: "/repo", parts, agent: "build", model }),
    ).resolves.toEqual({ taskID: "session-1", operationID: "msg-generated" })
    expect(calls.prompt).toEqual([
      {
        sessionID: "session-1",
        id: "msg-generated",
        agent: "build",
        model: { providerID: "provider-1", modelID: "model-1" },
        variant: "high",
        location: { directory: "/repo" },
        legacyParts: [
          { id: "part-text", type: "text", text: "Inspect these" },
          {
            id: "part-comment",
            type: "text",
            text: "Review line 3",
            synthetic: true,
            ignored: false,
            time: { start: 10, end: 11 },
            metadata: {
              opencodeComment: {
                path: "src/a.ts",
                selection: { startLine: 3, startChar: 0, endLine: 3, endChar: 8 },
                comment: "Review line 3",
                preview: "const a = 1",
                origin: "review",
              },
            },
          },
          {
            id: "part-file",
            type: "file",
            url: "file:///repo/src/a.ts",
            filename: "a.ts",
            mime: "text/plain",
            source: parts[2]?.type === "file" ? parts[2].source : undefined,
          },
          {
            id: "part-symbol",
            type: "file",
            url: "file:///repo/src/b.ts",
            filename: "b.ts",
            mime: "text/plain",
            source: parts[3]?.type === "file" ? parts[3].source : undefined,
          },
          {
            id: "part-resource",
            type: "file",
            url: "mcp://docs/1",
            filename: "docs",
            mime: "text/plain",
            source: parts[4]?.type === "file" ? parts[4].source : undefined,
          },
          { id: "part-agent", type: "agent", name: "planner", source: { value: "@planner", start: 35, end: 43 } },
        ],
        text: "Inspect these\nReview line 3",
        files: [
          { uri: "file:///repo/src/a.ts", name: "a.ts", mention: { text: "@src/a.ts", start: 14, end: 23 } },
          { uri: "file:///repo/src/b.ts", name: "b.ts", mention: { text: "@run", start: 24, end: 28 } },
          { uri: "mcp://docs/1", name: "docs", mention: { text: "@docs", start: 29, end: 34 } },
        ],
        agents: [{ name: "planner", mention: { text: "@planner", start: 35, end: 43 } }],
      },
    ])
  })

  test("preserves or generates operation identifiers for command and shell", async () => {
    const { adapter, calls } = setup()
    const files: readonly ProductFilePart[] = [
      { id: "file-1", type: "file", uri: "data:image/png;base64,AA", name: "a.png", mime: "image/png" },
    ]

    await expect(
      adapter.command({
        taskID: "session-1",
        directory: "/repo",
        messageID: "msg-provided",
        command: "review",
        arguments: "staged",
        files,
        agent: "build",
        model,
      }),
    ).resolves.toEqual({ taskID: "session-1", operationID: "msg-provided" })
    await expect(
      adapter.shell({ taskID: "session-1", directory: "/repo", command: "pwd", agent: "build", model }),
    ).resolves.toEqual({ taskID: "session-1", operationID: "evt-generated" })
    expect(calls.command).toEqual([
      {
        sessionID: "session-1",
        id: "msg-provided",
        command: "review",
        arguments: "staged",
        agent: "build",
        model: { id: "model-1", providerID: "provider-1", variant: "high" },
        files: [{ uri: "data:image/png;base64,AA", name: "a.png", mention: undefined }],
        location: { directory: "/repo" },
      },
    ])
    expect(calls.shell).toEqual([
      {
        sessionID: "session-1",
        id: "evt-generated",
        command: "pwd",
        agent: "build",
        model: { providerID: "provider-1", modelID: "model-1" },
        variant: "high",
        location: { directory: "/repo" },
      },
    ])
  })

  test("interrupts without fabricating a transport result", async () => {
    const { adapter, calls } = setup()

    await expect(adapter.interrupt({ taskID: "session-1", directory: "/repo" })).resolves.toBeUndefined()
    expect(calls.interrupt).toEqual([{ sessionID: "session-1", location: { directory: "/repo" } }])
  })

  test.each(["create", "prompt", "command", "shell", "interrupt"] as const)(
    "normalizes rejected %s calls",
    async (method) => {
      const api = {
        session: {
          create: async () => Promise.reject({ status: 401, message: "private" }),
          prompt: async () => Promise.reject({ status: 401, message: "private" }),
          command: async () => Promise.reject({ status: 401, message: "private" }),
          shell: async () => Promise.reject({ status: 401, message: "private" }),
          interrupt: async () => Promise.reject({ status: 401, message: "private" }),
        },
      } as unknown as CompatibleApi
      const adapter = createProductTaskAdapter(api)
      const operations = {
        create: () => adapter.create({ directory: "/repo", agent: "build", model }),
        prompt: () => adapter.prompt({ taskID: "session-1", directory: "/repo", parts: [], agent: "build", model }),
        command: () =>
          adapter.command({
            taskID: "session-1",
            directory: "/repo",
            command: "review",
            arguments: "",
            agent: "build",
            model,
          }),
        shell: () => adapter.shell({ taskID: "session-1", directory: "/repo", command: "pwd", agent: "build", model }),
        interrupt: () => adapter.interrupt({ taskID: "session-1", directory: "/repo" }),
      }

      await expect(operations[method]()).rejects.toEqual({
        kind: "authentication",
        message: "The model service rejected the saved credentials.",
        action: "Update the saved credentials for this model, then retry.",
        retryable: false,
        diagnostic: { status: 401 },
      })
    },
  )
})

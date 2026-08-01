import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import type { Config, Event } from "@opencode-ai/sdk/v2/client"
import { adaptProductServerEvent } from "@/context/server-sdk"
import { normalizeProductEvent } from "./events"
import type { CompatibleApi } from "@/utils/server-compat"

type RequiredSessionMethods = Pick<CompatibleApi["session"], "create" | "prompt" | "command" | "shell" | "interrupt">
type RequiredPermissionMethods = Pick<CompatibleApi["permission"], "reply">
type RequiredQuestionMethods = Pick<CompatibleApi["question"], "reply" | "reject">
type RequiredCompatibleApi = {
  readonly session: RequiredSessionMethods
  readonly permission: RequiredPermissionMethods
  readonly question: RequiredQuestionMethods
}
type CompatibleApiContractLocked = CompatibleApi extends RequiredCompatibleApi ? true : false

const contractLocked: CompatibleApiContractLocked = true

const modelCenterProviderConfig = {
  provider: {
    "agent-profile-contract": {
      npm: "@ai-sdk/openai-compatible",
      name: "Contract Provider",
      env: ["AGENT_PROFILE_CONTRACT_API_KEY"],
      options: { baseURL: "http://127.0.0.1:1234/v1", timeout: 30_000 },
      models: {
        coder: { name: "Coder", tool_call: true, limit: { context: 32_000, output: 4_000 } },
      },
    },
  },
  disabled_providers: [],
} satisfies Config

const modelCenterDefaultConfig = { model: "agent-profile-contract/coder" } satisfies Config

const textDelta = {
  id: "evt_contract_text",
  created: 1_725_000_000_001,
  type: "session.text.delta",
  location: { directory: "/repo" },
  data: {
    sessionID: "ses_contract",
    assistantMessageID: "msg_contract",
    ordinal: 1,
    delta: "hello",
  },
} satisfies Extract<OpenCodeEvent, { type: "session.text.delta" }>

const permissionAsked = {
  id: "evt_contract_permission",
  created: 1_725_000_000_002,
  type: "permission.v2.asked",
  location: { directory: "/repo" },
  data: {
    id: "perm_contract",
    sessionID: "ses_contract",
    action: "read",
    resources: ["src/**"],
    save: ["src/**"],
    source: { type: "tool", messageID: "msg_contract", callID: "call_contract" },
  },
} satisfies Extract<OpenCodeEvent, { type: "permission.v2.asked" }>

const shellEnded = {
  id: "evt_contract_shell",
  created: 1_725_000_000_003,
  type: "session.shell.ended",
  durable: { aggregateID: "ses_contract", seq: 1, version: 1 },
  location: { directory: "/repo" },
  data: {
    sessionID: "ses_contract",
    shell: {
      id: "shell_contract",
      status: "exited",
      command: "printf done",
      cwd: "/repo",
      shell: "/bin/zsh",
      file: "/tmp/shell.log",
      exit: 0,
      metadata: {},
      time: { started: 1_725_000_000_000, completed: 1_725_000_000_003 },
    },
    output: { output: "done", cursor: 4, size: 4, truncated: false },
  },
} satisfies Extract<OpenCodeEvent, { type: "session.shell.ended" }>

const executionStarted = {
  id: "evt_contract_execution",
  created: 1_725_000_000_004,
  type: "session.execution.started",
  durable: { aggregateID: "ses_contract", seq: 2, version: 1 },
  location: { directory: "/repo" },
  data: { sessionID: "ses_contract" },
} satisfies Extract<OpenCodeEvent, { type: "session.execution.started" }>

const reasoningDelta = {
  id: "evt_contract_reasoning",
  created: 1_725_000_000_005,
  type: "session.reasoning.delta",
  location: { directory: "/repo" },
  data: { sessionID: "ses_contract", assistantMessageID: "msg_contract", ordinal: 0, delta: "think" },
} satisfies Extract<OpenCodeEvent, { type: "session.reasoning.delta" }>

const toolInputStarted = {
  id: "evt_contract_tool",
  created: 1_725_000_000_006,
  type: "session.tool.input.started",
  durable: { aggregateID: "ses_contract", seq: 3, version: 1 },
  location: { directory: "/repo" },
  data: {
    sessionID: "ses_contract",
    assistantMessageID: "msg_contract",
    callID: "call_contract",
    name: "read",
  },
} satisfies Extract<OpenCodeEvent, { type: "session.tool.input.started" }>

const permissionReplied = {
  id: "evt_contract_permission_reply",
  created: 1_725_000_000_007,
  type: "permission.v2.replied",
  location: { directory: "/repo" },
  data: { sessionID: "ses_contract", requestID: "perm_contract", reply: "once" },
} satisfies Extract<OpenCodeEvent, { type: "permission.v2.replied" }>

const questionReplied = {
  id: "evt_contract_question",
  created: 1_725_000_000_008,
  type: "question.v2.replied",
  location: { directory: "/repo" },
  data: { sessionID: "ses_contract", requestID: "question_contract", answers: [["automatic"]] },
} satisfies Extract<OpenCodeEvent, { type: "question.v2.replied" }>

const filesystemChanged = {
  id: "evt_contract_file",
  created: 1_725_000_000_009,
  type: "filesystem.changed",
  location: { directory: "/repo" },
  data: { file: "src/index.ts", event: "change" },
} satisfies Extract<OpenCodeEvent, { type: "filesystem.changed" }>

const sessionError = {
  id: "evt_contract_error",
  created: 1_725_000_000_010,
  type: "session.error",
  location: { directory: "/repo" },
  data: { sessionID: "ses_contract" },
} satisfies Extract<OpenCodeEvent, { type: "session.error" }>

const serverConnected = {
  id: "evt_contract_server",
  type: "server.connected",
  location: { directory: "/repo" },
  data: {},
} satisfies Extract<OpenCodeEvent, { type: "server.connected" }>

const sdkReasoningDelta = {
  id: "evt_sdk_reasoning",
  type: "session.next.reasoning.delta",
  properties: {
    timestamp: 1_725_000_000_011,
    sessionID: "ses_contract",
    assistantMessageID: "msg_contract",
    reasoningID: "reasoning_contract",
    delta: "think",
  },
} satisfies Extract<Event, { type: "session.next.reasoning.delta" }>

const sdkToolInputStarted = {
  id: "evt_sdk_tool",
  type: "session.next.tool.input.started",
  properties: {
    timestamp: 1_725_000_000_012,
    sessionID: "ses_contract",
    assistantMessageID: "msg_contract",
    callID: "call_contract",
    name: "read",
  },
} satisfies Extract<Event, { type: "session.next.tool.input.started" }>

const sdkShellEnded = {
  id: "evt_sdk_shell",
  type: "session.next.shell.ended",
  properties: { timestamp: 1_725_000_000_013, sessionID: "ses_contract", callID: "call_shell", output: "done" },
} satisfies Extract<Event, { type: "session.next.shell.ended" }>

const sdkCommandExecuted = {
  id: "evt_sdk_command",
  type: "command.executed",
  properties: { name: "review", sessionID: "ses_contract", arguments: "--staged", messageID: "msg_contract" },
} satisfies Extract<Event, { type: "command.executed" }>

const sdkPermissionReplied = {
  id: "evt_sdk_permission",
  type: "permission.replied",
  properties: { sessionID: "ses_contract", requestID: "perm_contract", reply: "once" },
} satisfies Extract<Event, { type: "permission.replied" }>

const sdkPermissionV2Asked = {
  id: "evt_sdk_permission_v2",
  type: "permission.v2.asked",
  properties: {
    id: "perm_contract_v2",
    sessionID: "ses_contract",
    action: "read",
    resources: ["src/**"],
    source: { type: "tool", messageID: "msg_contract", callID: "call_contract" },
  },
} satisfies Extract<Event, { type: "permission.v2.asked" }>

const sdkQuestionReplied = {
  id: "evt_sdk_question",
  type: "question.replied",
  properties: { sessionID: "ses_contract", requestID: "question_contract", answers: [["automatic"]] },
} satisfies Extract<Event, { type: "question.replied" }>

const sdkFileChanged = {
  id: "evt_sdk_file",
  type: "file.watcher.updated",
  properties: { file: "src/index.ts", event: "change" },
} satisfies Extract<Event, { type: "file.watcher.updated" }>

const sdkSessionError = {
  id: "evt_sdk_error",
  type: "session.error",
  properties: { sessionID: "ses_contract" },
} satisfies Extract<Event, { type: "session.error" }>

const sdkWorkspaceStatus = {
  id: "evt_sdk_workspace",
  type: "workspace.status",
  properties: { workspaceID: "workspace_contract", status: "connected" },
} satisfies Extract<Event, { type: "workspace.status" }>

const sdkServerConnected = {
  id: "evt_sdk_server",
  type: "server.connected",
  properties: {},
} satisfies Extract<Event, { type: "server.connected" }>

const sdkReasoningSnapshot = {
  id: "evt_sdk_part",
  type: "message.part.updated",
  properties: {
    sessionID: "ses_contract",
    time: 1_725_000_000_014,
    part: {
      id: "prt_contract",
      sessionID: "ses_contract",
      messageID: "msg_contract",
      type: "reasoning",
      text: "complete",
      time: { start: 1_725_000_000_000, end: 1_725_000_000_014 },
    },
  },
} satisfies Extract<Event, { type: "message.part.updated" }>

const sdkAdvanced = {
  id: "evt_sdk_advanced",
  type: "installation.updated",
  properties: { version: "1.18.10" },
} satisfies Extract<Event, { type: "installation.updated" }>

describe("product OpenCode contracts", () => {
  test("locks the CompatibleApi methods consumed by product workflows", () => {
    expect(contractLocked).toBe(true)
  })

  test("locks model-center patches to the public OpenCode config shape", () => {
    expect(modelCenterProviderConfig.provider?.["agent-profile-contract"]?.npm).toBe(
      "@ai-sdk/openai-compatible",
    )
    expect(modelCenterDefaultConfig.model).toBe("agent-profile-contract/coder")
  })

  test("adapts recorded OpenCode event fixtures", () => {
    expect(adaptProductServerEvent(textDelta)).toEqual({
      id: "evt_contract_text",
      type: "assistant.text.delta",
      taskID: "ses_contract",
      directory: "/repo",
      time: 1_725_000_000_001,
      data: { messageID: "msg_contract", ordinal: 1, delta: "hello" },
    })
    expect(adaptProductServerEvent(shellEnded)).toMatchObject({
      type: "shell.output",
      taskID: "ses_contract",
      data: { operationID: "shell_contract", output: "done" },
    })
    expect(
      [
        executionStarted,
        reasoningDelta,
        toolInputStarted,
        permissionReplied,
        questionReplied,
        filesystemChanged,
        sessionError,
        serverConnected,
      ].map((event) => adaptProductServerEvent(event).type),
    ).toEqual([
      "task.execution.started",
      "assistant.reasoning.delta",
      "tool.input.started",
      "permission.replied",
      "question.replied",
      "file.changed",
      "error",
      "server.connected",
    ])
  })

  test("reuses protocol adaptation for V2 permissions", () => {
    expect(adaptProductServerEvent(permissionAsked)).toEqual({
      id: "evt_contract_permission",
      type: "permission.asked",
      taskID: "ses_contract",
      directory: "/repo",
      time: 1_725_000_000_002,
      data: {
        requestID: "perm_contract",
        capability: "read",
        resources: ["src/**"],
        remember: ["src/**"],
        messageID: "msg_contract",
        callID: "call_contract",
      },
    })
  })

  test("adapts typed SDK event fixtures", () => {
    const fixtures: Event[] = [
      sdkReasoningDelta,
      sdkToolInputStarted,
      sdkShellEnded,
      sdkCommandExecuted,
      sdkPermissionReplied,
      sdkPermissionV2Asked,
      sdkQuestionReplied,
      sdkFileChanged,
      sdkSessionError,
      sdkWorkspaceStatus,
      sdkServerConnected,
      sdkReasoningSnapshot,
      sdkAdvanced,
    ]
    expect(fixtures.map((event) => normalizeProductEvent(event, "/repo").type)).toEqual([
      "assistant.reasoning.delta",
      "tool.input.started",
      "shell.output",
      "command.output",
      "permission.replied",
      "permission.asked",
      "question.replied",
      "file.changed",
      "error",
      "server.status",
      "server.connected",
      "assistant.reasoning.updated",
      "advanced",
    ])
    expect(normalizeProductEvent(sdkReasoningDelta, "/repo")).toMatchObject({
      id: "evt_sdk_reasoning",
      directory: "/repo",
      time: 1_725_000_000_011,
    })
  })
})

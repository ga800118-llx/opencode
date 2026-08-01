import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { adaptProductServerEvent } from "@/context/server-sdk"
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

describe("product OpenCode contracts", () => {
  test("locks the CompatibleApi methods consumed by product workflows", () => {
    expect(contractLocked).toBe(true)
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
})

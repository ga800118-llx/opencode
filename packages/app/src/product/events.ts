import type {
  ProductError,
  ProductEventEnvelope,
  ProductOptionalTaskEvent,
  ProductTaskEvent,
} from "./contracts"
import { normalizeProductError } from "./errors"

export type AdaptedProductEventInput = {
  readonly id?: unknown
  readonly type?: unknown
  readonly properties?: unknown
  readonly current?: unknown
  readonly created?: unknown
  readonly time?: unknown
  readonly location?: unknown
}

export type ProductQuestion = {
  readonly header: string
  readonly question: string
  readonly options: readonly { readonly label: string; readonly description?: string }[]
  readonly multiple: boolean
  readonly custom: boolean
}

export type ProductEvent =
  | ProductTaskEvent<"task.created" | "task.updated", { readonly title?: string }>
  | ProductTaskEvent<"task.deleted", Record<string, never>>
  | ProductTaskEvent<
      "task.execution.started" | "task.execution.succeeded" | "task.idle",
      Record<string, never>
    >
  | ProductTaskEvent<"task.execution.failed", { readonly error: ProductError }>
  | ProductTaskEvent<"task.execution.interrupted", { readonly reason?: "user" | "shutdown" | "superseded" }>
  | ProductTaskEvent<
      "task.status",
      { readonly status: "idle" | "busy" | "retry" | "unknown"; readonly attempt?: number; readonly next?: number }
    >
  | ProductTaskEvent<
      "assistant.text.delta" | "assistant.reasoning.delta",
      { readonly messageID: string; readonly partID?: string; readonly ordinal?: number; readonly delta: string }
    >
  | ProductTaskEvent<
      "assistant.part.delta",
      { readonly messageID: string; readonly partID: string; readonly field: string; readonly delta: string }
    >
  | ProductTaskEvent<
      "assistant.text.updated" | "assistant.reasoning.updated",
      { readonly messageID: string; readonly partID: string; readonly text: string }
    >
  | ProductTaskEvent<
      "assistant.step.started" | "assistant.step.succeeded",
      { readonly messageID: string; readonly finish?: string }
    >
  | ProductTaskEvent<"assistant.step.failed", { readonly messageID: string; readonly error: ProductError }>
  | ProductTaskEvent<
      "tool.input.started",
      { readonly messageID: string; readonly callID: string; readonly name: string }
    >
  | ProductTaskEvent<
      "tool.input.delta",
      { readonly messageID: string; readonly callID: string; readonly delta: string }
    >
  | ProductTaskEvent<
      "tool.input.completed",
      { readonly messageID: string; readonly callID: string; readonly input: string }
    >
  | ProductTaskEvent<
      "tool.called" | "tool.progress" | "tool.succeeded",
      { readonly messageID: string; readonly callID: string; readonly executed?: boolean }
    >
  | ProductTaskEvent<
      "tool.failed",
      { readonly messageID: string; readonly callID: string; readonly executed?: boolean; readonly error: ProductError }
    >
  | ProductTaskEvent<
      "shell.output",
      {
        readonly operationID?: string
        readonly output: string
        readonly cursor?: number
        readonly size?: number
        readonly truncated?: boolean
      }
    >
  | ProductTaskEvent<
      "command.output",
      { readonly command: string; readonly arguments: string; readonly messageID?: string; readonly output?: string }
    >
  | ProductTaskEvent<
      "permission.asked",
      {
        readonly requestID: string
        readonly capability: string
        readonly resources: readonly string[]
        readonly remember: readonly string[]
        readonly messageID?: string
        readonly callID?: string
      }
    >
  | ProductTaskEvent<
      "permission.replied",
      { readonly requestID: string; readonly response: "allow-once" | "allow-always" | "reject" | "unknown" }
    >
  | ProductTaskEvent<"question.asked", { readonly requestID: string; readonly questions: readonly ProductQuestion[] }>
  | ProductTaskEvent<"question.replied", { readonly requestID: string; readonly answers: readonly (readonly string[])[] }>
  | ProductTaskEvent<"question.rejected", { readonly requestID: string }>
  | ProductEventEnvelope<"file.changed", { readonly path: string; readonly change: "add" | "change" | "unlink" }>
  | ProductOptionalTaskEvent<"error", { readonly error: ProductError }>
  | ProductEventEnvelope<"server.connected", Record<string, never>>
  | ProductEventEnvelope<
      "server.status",
      {
        readonly status: "connected" | "connecting" | "disconnected" | "error" | "unknown"
        readonly workspaceID?: string
      }
    >
  | ProductOptionalTaskEvent<"advanced", { readonly sourceType: string }>

type UnknownRecord = Record<string, unknown>
type Envelope = Pick<ProductEventEnvelope, "id" | "directory" | "time">

const MAX_QUESTIONS = 32
const MAX_OPTIONS_PER_QUESTION = 64
const MAX_ANSWERS = 32
const MAX_ANSWER_VALUES = 64
const MAX_PERMISSION_PATTERNS = 256
const MAX_FORM_TEXT_LENGTH = 16_384

export function normalizeProductEvent(input: AdaptedProductEventInput, directory?: string): ProductEvent {
  const properties = record(input.properties)
  const type = text(input.type) ?? "unknown"
  const taskID = identifier(properties.sessionID) ?? identifier(properties.taskID)
  const envelope = eventEnvelope(input, directory, properties)

  if (type === "session.created" || type === "session.updated") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    const title = text(record(properties.info).title)
    return {
      ...envelope,
      type: type === "session.created" ? "task.created" : "task.updated",
      taskID,
      data: title ? { title } : {},
    }
  }
  if (type === "session.deleted") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    return { ...envelope, type: "task.deleted", taskID, data: {} }
  }
  if (type === "session.execution.started" || type === "session.execution.succeeded" || type === "session.idle") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    const normalized =
      type === "session.execution.started"
        ? "task.execution.started"
        : type === "session.execution.succeeded"
          ? "task.execution.succeeded"
          : "task.idle"
    return { ...envelope, type: normalized, taskID, data: {} }
  }
  if (type === "session.execution.failed") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    return { ...envelope, type: "task.execution.failed", taskID, data: { error: normalizeProductError(properties.error) } }
  }
  if (type === "session.execution.interrupted") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    const reason = interruptionReason(properties.reason)
    return {
      ...envelope,
      type: "task.execution.interrupted",
      taskID,
      data: reason ? { reason } : {},
    }
  }
  if (
    type === "session.step.started" ||
    type === "session.step.ended" ||
    type === "session.step.failed" ||
    type === "session.next.step.started" ||
    type === "session.next.step.ended" ||
    type === "session.next.step.failed"
  )
    return assistantStep(properties, envelope, type)
  if (type === "session.status") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    const status = record(properties.status)
    const attempt = number(status.attempt)
    const next = number(status.next)
    return {
      ...envelope,
      type: "task.status",
      taskID,
      data: {
        status: taskStatus(status.type),
        ...(attempt === undefined ? {} : { attempt }),
        ...(next === undefined ? {} : { next }),
      },
    }
  }
  if (type === "session.retry.scheduled" || type === "session.next.retried") {
    if (!taskID) return advancedEvent(type, properties, envelope)
    const attempt = number(properties.attempt)
    const next = number(properties.at) ?? number(properties.next)
    return {
      ...envelope,
      type: "task.status",
      taskID,
      data: {
        status: "retry",
        ...(attempt === undefined ? {} : { attempt }),
        ...(next === undefined ? {} : { next }),
      },
    }
  }
  if (
    type === "session.text.delta" ||
    type === "session.reasoning.delta" ||
    type === "session.next.text.delta" ||
    type === "session.next.reasoning.delta"
  ) {
    const messageID = identifier(properties.assistantMessageID)
    const delta = text(properties.delta)
    if (!taskID || !messageID || delta === undefined) return advancedEvent(type, properties, envelope)
    const ordinal = number(properties.ordinal)
    const partID =
      type === "session.next.text.delta"
        ? identifier(properties.textID)
        : type === "session.next.reasoning.delta"
          ? identifier(properties.reasoningID)
          : undefined
    return {
      ...envelope,
      type:
        type === "session.text.delta" || type === "session.next.text.delta"
          ? "assistant.text.delta"
          : "assistant.reasoning.delta",
      taskID,
      data: { messageID, ...(partID ? { partID } : {}), ...(ordinal === undefined ? {} : { ordinal }), delta },
    }
  }
  if (type === "message.part.delta") return legacyAssistantDelta(properties, envelope, type)
  if (type === "message.part.updated") return legacyPartUpdated(properties, envelope, type)

  if (type === "session.tool.input.started" || type === "session.next.tool.input.started") {
    const common = toolFields(properties)
    const name = text(properties.name)
    if (!taskID || !common || !name) return advancedEvent(type, properties, envelope)
    return { ...envelope, type: "tool.input.started", taskID, data: { ...common, name } }
  }
  if (type === "session.tool.input.delta" || type === "session.next.tool.input.delta") {
    const common = toolFields(properties)
    const delta = text(properties.delta)
    if (!taskID || !common || delta === undefined) return advancedEvent(type, properties, envelope)
    return { ...envelope, type: "tool.input.delta", taskID, data: { ...common, delta } }
  }
  if (type === "session.tool.input.ended" || type === "session.next.tool.input.ended") {
    const common = toolFields(properties)
    const value = text(properties.text)
    if (!taskID || !common || value === undefined) return advancedEvent(type, properties, envelope)
    return { ...envelope, type: "tool.input.completed", taskID, data: { ...common, input: value } }
  }
  if (
    type === "session.tool.called" ||
    type === "session.tool.progress" ||
    type === "session.tool.success" ||
    type === "session.next.tool.called" ||
    type === "session.next.tool.progress" ||
    type === "session.next.tool.success"
  ) {
    const common = toolFields(properties)
    if (!taskID || !common) return advancedEvent(type, properties, envelope)
    const normalized =
      type === "session.tool.called" || type === "session.next.tool.called"
        ? "tool.called"
        : type === "session.tool.progress" || type === "session.next.tool.progress"
          ? "tool.progress"
          : "tool.succeeded"
    const executed = boolean(properties.executed) ?? boolean(record(properties.provider).executed)
    return {
      ...envelope,
      type: normalized,
      taskID,
      data: { ...common, ...(executed === undefined ? {} : { executed }) },
    }
  }
  if (type === "session.tool.failed" || type === "session.next.tool.failed") {
    const common = toolFields(properties)
    if (!taskID || !common) return advancedEvent(type, properties, envelope)
    const executed = boolean(properties.executed) ?? boolean(record(properties.provider).executed)
    return {
      ...envelope,
      type: "tool.failed",
      taskID,
      data: {
        ...common,
        ...(executed === undefined ? {} : { executed }),
        error: normalizeProductError(properties.error),
      },
    }
  }
  if (type === "session.shell.ended" || type === "session.next.shell.ended")
    return shellOutput(properties, envelope, type)
  if (type === "command.executed") return commandOutput(properties, envelope, type)
  if (type === "permission.asked") return permissionAsked(properties, envelope, type)
  if (type === "permission.replied") return permissionReplied(properties, envelope, type)
  if (type === "question.asked") return questionAsked(properties, envelope, type)
  if (type === "question.replied") return questionReplied(properties, envelope, type)
  if (type === "question.rejected") return questionRejected(properties, envelope, type)
  if (type === "filesystem.changed" || type === "file.watcher.updated" || type === "file.edited") {
    const path = text(properties.file)
    if (!path) return advancedEvent(type, properties, envelope)
    return {
      ...envelope,
      type: "file.changed",
      data: { path, change: type === "file.edited" ? "change" : fileChange(properties.event) },
    }
  }
  if (type === "session.error") {
    return {
      ...envelope,
      type: "error",
      ...(taskID ? { taskID } : {}),
      data: { error: normalizeProductError(properties.error) },
    }
  }
  if (type === "server.connected") return { ...envelope, type: "server.connected", data: {} }
  if (type === "workspace.status" || type === "workspace.ready" || type === "workspace.failed") {
    const status =
      type === "workspace.ready"
        ? "connected"
        : type === "workspace.failed"
          ? "error"
          : serverStatus(properties.status)
    const workspaceID = identifier(properties.workspaceID)
    return { ...envelope, type: "server.status", data: { status, ...(workspaceID ? { workspaceID } : {}) } }
  }

  return advancedEvent(type, properties, envelope)
}

function eventEnvelope(input: AdaptedProductEventInput, directory: string | undefined, properties: UnknownRecord): Envelope {
  const current = record(input.current)
  const info = record(properties.info)
  const selectedDirectory =
    nonEmpty(directory) ??
    nonEmpty(record(current.location).directory) ??
    nonEmpty(record(input.location).directory) ??
    nonEmpty(info.directory) ??
    nonEmpty(record(info.location).directory)
  const id = identifier(input.id) ?? identifier(current.id)
  const time =
    number(current.created) ??
    number(input.created) ??
    number(input.time) ??
    number(properties.timestamp) ??
    number(properties.time)
  return {
    ...(id ? { id } : {}),
    ...(selectedDirectory ? { directory: selectedDirectory } : {}),
    ...(time === undefined ? {} : { time }),
  }
}

function assistantStep(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const messageID = identifier(properties.assistantMessageID)
  if (!taskID || !messageID) return advancedEvent(sourceType, properties, envelope)
  if (sourceType.endsWith(".started")) {
    return { ...envelope, type: "assistant.step.started", taskID, data: { messageID } }
  }
  if (sourceType.endsWith(".failed")) {
    return {
      ...envelope,
      type: "assistant.step.failed",
      taskID,
      data: { messageID, error: normalizeProductError(properties.error) },
    }
  }
  const finish = text(properties.finish)
  return {
    ...envelope,
    type: "assistant.step.succeeded",
    taskID,
    data: { messageID, ...(finish ? { finish } : {}) },
  }
}

function legacyAssistantDelta(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const messageID = identifier(properties.messageID)
  const partID = identifier(properties.partID)
  const delta = text(properties.delta)
  const field = text(properties.field)
  if (!taskID || !messageID || !partID || delta === undefined || !field)
    return advancedEvent(sourceType, properties, envelope)
  return {
    ...envelope,
    type: "assistant.part.delta",
    taskID,
    data: { messageID, partID, field, delta },
  }
}

function legacyPartUpdated(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const part = record(properties.part)
  const taskID = identifier(properties.sessionID) ?? identifier(part.sessionID)
  const messageID = identifier(part.messageID)
  const partID = identifier(part.id)
  if (!taskID || !messageID || !partID) return advancedEvent(sourceType, properties, envelope)
  if (part.type === "text" || part.type === "reasoning") {
    const value = text(part.text)
    if (value === undefined) return advancedEvent(sourceType, properties, envelope)
    return {
      ...envelope,
      type: part.type === "text" ? "assistant.text.updated" : "assistant.reasoning.updated",
      taskID,
      data: { messageID, partID, text: value },
    }
  }
  if (part.type !== "tool") return advancedEvent(sourceType, properties, envelope)
  const callID = identifier(part.callID)
  const state = record(part.state)
  if (!callID) return advancedEvent(sourceType, properties, envelope)
  if (state.status === "pending") {
    const input = text(state.raw)
    if (input === undefined) return advancedEvent(sourceType, properties, envelope)
    return { ...envelope, type: "tool.input.completed", taskID, data: { messageID, callID, input } }
  }
  if (state.status === "running") {
    return { ...envelope, type: "tool.called", taskID, data: { messageID, callID } }
  }
  if (state.status === "completed") {
    return { ...envelope, type: "tool.succeeded", taskID, data: { messageID, callID } }
  }
  if (state.status === "error") {
    return {
      ...envelope,
      type: "tool.failed",
      taskID,
      data: { messageID, callID, error: normalizeProductError(state.error) },
    }
  }
  return advancedEvent(sourceType, properties, envelope)
}

function shellOutput(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const shell = record(properties.shell)
  const output = record(properties.output)
  const value = text(properties.output) ?? text(output.output)
  if (!taskID || value === undefined) return advancedEvent(sourceType, properties, envelope)
  const operationID = identifier(shell.id) ?? identifier(properties.callID)
  const cursor = number(output.cursor)
  const size = number(output.size)
  const truncated = boolean(output.truncated)
  return {
    ...envelope,
    type: "shell.output",
    taskID,
    data: {
      ...(operationID ? { operationID } : {}),
      output: value,
      ...(cursor === undefined ? {} : { cursor }),
      ...(size === undefined ? {} : { size }),
      ...(truncated === undefined ? {} : { truncated }),
    },
  }
}

function commandOutput(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const command = text(properties.name) ?? text(properties.command)
  if (!taskID || !command) return advancedEvent(sourceType, properties, envelope)
  const messageID = identifier(properties.messageID)
  const output = text(properties.output)
  return {
    ...envelope,
    type: "command.output",
    taskID,
    data: {
      command,
      arguments: text(properties.arguments) ?? "",
      ...(messageID ? { messageID } : {}),
      ...(output === undefined ? {} : { output }),
    },
  }
}

function permissionAsked(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const requestID = identifier(properties.id)
  const capability = text(properties.permission)
  const resources = stringArray(properties.patterns, MAX_PERMISSION_PATTERNS, MAX_FORM_TEXT_LENGTH)
  const remember = stringArray(properties.always, MAX_PERMISSION_PATTERNS, MAX_FORM_TEXT_LENGTH)
  if (!taskID || !requestID || !capability || !resources || !remember)
    return advancedEvent(sourceType, properties, envelope)
  const tool = record(properties.tool)
  const messageID = identifier(tool.messageID)
  const callID = identifier(tool.callID)
  return {
    ...envelope,
    type: "permission.asked",
    taskID,
    data: { requestID, capability, resources, remember, ...(messageID ? { messageID } : {}), ...(callID ? { callID } : {}) },
  }
}

function permissionReplied(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const requestID = identifier(properties.requestID)
  if (!taskID || !requestID) return advancedEvent(sourceType, properties, envelope)
  const reply = text(properties.reply)
  const response = reply === "once" ? "allow-once" : reply === "always" ? "allow-always" : reply === "reject" ? "reject" : "unknown"
  return { ...envelope, type: "permission.replied", taskID, data: { requestID, response } }
}

function questionAsked(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const requestID = identifier(properties.id)
  const questions = productQuestions(properties.questions)
  if (!taskID || !requestID || !questions) return advancedEvent(sourceType, properties, envelope)
  return { ...envelope, type: "question.asked", taskID, data: { requestID, questions } }
}

function questionReplied(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const requestID = identifier(properties.requestID)
  const answers = stringMatrix(properties.answers)
  if (!taskID || !requestID || !answers) return advancedEvent(sourceType, properties, envelope)
  return { ...envelope, type: "question.replied", taskID, data: { requestID, answers } }
}

function questionRejected(properties: UnknownRecord, envelope: Envelope, sourceType: string): ProductEvent {
  const taskID = identifier(properties.sessionID)
  const requestID = identifier(properties.requestID)
  if (!taskID || !requestID) return advancedEvent(sourceType, properties, envelope)
  return { ...envelope, type: "question.rejected", taskID, data: { requestID } }
}

function productQuestions(value: unknown): readonly ProductQuestion[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) return undefined
  const questions: ProductQuestion[] = []
  for (const item of value) {
    const source = record(item)
    const header = boundedText(source.header, MAX_FORM_TEXT_LENGTH)
    const question = boundedText(source.question, MAX_FORM_TEXT_LENGTH)
    if (!header || !question || !Array.isArray(source.options) || source.options.length > MAX_OPTIONS_PER_QUESTION)
      return undefined
    const options: Array<{ label: string; description?: string }> = []
    for (const option of source.options) {
      const entry = record(option)
      const label = boundedText(entry.label, MAX_FORM_TEXT_LENGTH)
      if (!label) return undefined
      const description = boundedText(entry.description, MAX_FORM_TEXT_LENGTH)
      options.push({ label, ...(description ? { description } : {}) })
    }
    questions.push({
      header,
      question,
      options,
      multiple: boolean(source.multiple) ?? false,
      custom: boolean(source.custom) ?? false,
    })
  }
  return questions
}

function toolFields(properties: UnknownRecord) {
  const messageID = identifier(properties.assistantMessageID) ?? identifier(properties.messageID)
  const callID = identifier(properties.callID)
  if (!messageID || !callID) return undefined
  return { messageID, callID }
}

function advancedEvent(sourceType: string, properties: UnknownRecord, envelope: Envelope): ProductEvent {
  const taskID = identifier(properties.sessionID) ?? identifier(properties.taskID)
  return {
    ...envelope,
    type: "advanced",
    ...(taskID ? { taskID } : {}),
    data: { sourceType: safeSourceType(sourceType) },
  }
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : undefined
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function identifier(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function boolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined
  const result: string[] = []
  for (const item of value) {
    const selected = boundedText(item, maxLength)
    if (selected === undefined) return undefined
    result.push(selected)
  }
  return result
}

function stringMatrix(value: unknown): string[][] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ANSWERS) return undefined
  const result: string[][] = []
  for (const item of value) {
    const row = stringArray(item, MAX_ANSWER_VALUES, MAX_FORM_TEXT_LENGTH)
    if (!row) return undefined
    result.push([...row])
  }
  return result
}

function interruptionReason(value: unknown) {
  return value === "user" || value === "shutdown" || value === "superseded" ? value : undefined
}

function taskStatus(value: unknown) {
  return value === "idle" || value === "busy" || value === "retry" ? value : "unknown"
}

function serverStatus(value: unknown) {
  return value === "connected" || value === "connecting" || value === "disconnected" || value === "error"
    ? value
    : "unknown"
}

function fileChange(value: unknown) {
  return value === "add" || value === "unlink" ? value : "change"
}

function safeSourceType(value: string) {
  return value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value) ? value : "unknown"
}

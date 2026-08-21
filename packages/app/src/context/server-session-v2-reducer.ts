import type { OpenCodeEvent, SessionMessageInfo, SessionPendingMessage } from "@opencode-ai/client/promise"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Compaction = Extract<SessionMessageInfo, { type: "compaction" }>
type Shell = Extract<SessionMessageInfo, { type: "shell" }>
type NativeEvent<Type extends string, Data extends object> = {
  readonly id: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly type: Type
  readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
  readonly location?: { readonly directory: string; readonly workspaceID?: string }
  readonly data: {
    readonly timestamp: number
    readonly sessionID: string
  } & Data
}
type NativeToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
type NativeProvider = {
  readonly executed: boolean
  readonly metadata?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}
type NativeSessionEvent =
  | NativeEvent<
      "session.next.step.started",
      {
        readonly assistantMessageID: string
        readonly agent: string
        readonly model: Assistant["model"]
        readonly snapshot?: string
      }
    >
  | NativeEvent<
      "session.next.step.ended",
      {
        readonly assistantMessageID: string
        readonly finish: string
        readonly cost: number
        readonly tokens: NonNullable<Assistant["tokens"]>
        readonly snapshot?: string
        readonly files?: readonly string[]
      }
    >
  | NativeEvent<
      "session.next.step.failed",
      { readonly assistantMessageID: string; readonly error: NonNullable<Assistant["error"]> }
    >
  | NativeEvent<"session.next.text.started", { readonly assistantMessageID: string; readonly textID: string }>
  | NativeEvent<
      "session.next.text.delta",
      { readonly assistantMessageID: string; readonly textID: string; readonly delta: string }
    >
  | NativeEvent<
      "session.next.text.ended",
      { readonly assistantMessageID: string; readonly textID: string; readonly text: string }
    >
  | NativeEvent<
      "session.next.reasoning.started",
      {
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly providerMetadata?: NativeProvider["metadata"]
      }
    >
  | NativeEvent<
      "session.next.reasoning.delta",
      { readonly assistantMessageID: string; readonly reasoningID: string; readonly delta: string }
    >
  | NativeEvent<
      "session.next.reasoning.ended",
      {
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly text: string
        readonly providerMetadata?: NativeProvider["metadata"]
      }
    >
  | NativeEvent<
      "session.next.tool.input.started",
      { readonly assistantMessageID: string; readonly callID: string; readonly name: string }
    >
  | NativeEvent<
      "session.next.tool.input.delta",
      { readonly assistantMessageID: string; readonly callID: string; readonly delta: string }
    >
  | NativeEvent<
      "session.next.tool.input.ended",
      { readonly assistantMessageID: string; readonly callID: string; readonly text: string }
    >
  | NativeEvent<
      "session.next.tool.called",
      {
        readonly assistantMessageID: string
        readonly callID: string
        readonly input: Readonly<Record<string, unknown>>
        readonly provider: NativeProvider
      }
    >
  | NativeEvent<
      "session.next.tool.progress",
      {
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: Readonly<Record<string, unknown>>
        readonly content: readonly NativeToolContent[]
      }
    >
  | NativeEvent<
      "session.next.tool.success",
      {
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: Readonly<Record<string, unknown>>
        readonly content: readonly NativeToolContent[]
        readonly provider: NativeProvider
      }
    >
  | NativeEvent<
      "session.next.tool.failed",
      {
        readonly assistantMessageID: string
        readonly callID: string
        readonly error: NonNullable<Assistant["error"]>
        readonly provider: NativeProvider
      }
    >

export type V2SessionReduction = {
  sessionID: string
  messages: SessionMessageInfo[]
  touched: string[]
  missing?: string
}

export function createV2SessionReducer() {
  const pending = new Map<string, SessionPendingMessage>()
  const nativeOrdinals = new Map<string, number>()

  const reduce = (
    source: readonly SessionMessageInfo[],
    event: OpenCodeEvent | NativeSessionEvent,
  ): V2SessionReduction | undefined => {
    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
    const sessionID = event.data.sessionID
    const result = (messages: SessionMessageInfo[], touched: string[] = []): V2SessionReduction => ({
      sessionID,
      messages,
      touched,
    })
    const append = (message: SessionMessageInfo) =>
      result(source.some((item) => item.id === message.id) ? [...source] : [...source, message], [message.id])
    const native = nativeSessionEvent(event)
    const current = native ? adaptNativeSessionEvent(source, native, nativeOrdinals) : undefined
    if (current) return reduce(source, current)

    switch (event.type) {
      case "session.input.admitted":
        pending.set(key(sessionID, event.data.inputID), event.data.input)
        return result([...source])
      case "session.input.promoted": {
        const input = pending.get(key(sessionID, event.data.inputID))
        pending.delete(key(sessionID, event.data.inputID))
        if (!input) return { ...result([...source]), missing: event.data.inputID }
        if (input.type === "user")
          return append({
            id: event.data.inputID,
            type: "user",
            metadata: input.data.metadata,
            text: input.data.text,
            files: input.data.files,
            agents: input.data.agents,
            time: { created: event.created },
          })
        return append({
          id: event.data.inputID,
          type: "synthetic",
          metadata: input.data.metadata,
          text: input.data.text,
          description: input.data.description,
          time: { created: event.created },
        })
      }
      case "session.agent.selected":
        return append({
          id: messageID(event.id),
          type: "agent-switched",
          metadata: event.metadata,
          agent: event.data.agent,
          time: { created: event.created },
        })
      case "session.model.selected":
        return append({
          id: messageID(event.id),
          type: "model-switched",
          metadata: event.metadata,
          model: event.data.model,
          previous: source.findLast(
            (item): item is Extract<SessionMessageInfo, { type: "model-switched" | "assistant" }> =>
              item.type === "model-switched" || item.type === "assistant",
          )?.model,
          time: { created: event.created },
        })
      case "session.synthetic":
        return append({
          id: messageID(event.id),
          type: "synthetic",
          metadata: event.data.metadata,
          text: event.data.text,
          description: event.data.description,
          time: { created: event.created },
        })
      case "session.skill.activated":
        return append({
          id: messageID(event.id),
          type: "skill",
          metadata: event.metadata,
          skill: event.data.id,
          name: event.data.name,
          text: event.data.text,
          time: { created: event.created },
        })
      case "session.shell.started":
        return append({
          id: messageID(event.id),
          type: "shell",
          metadata: event.metadata,
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          time: { created: event.created },
        })
      case "session.shell.ended":
        return updateMessage<Shell>(
          source,
          (item): item is Shell => item.type === "shell" && item.shellID === event.data.shell.id,
          (item) => ({
            ...item,
            status: event.data.shell.status,
            exit: event.data.shell.exit,
            output: event.data.output,
            time: { ...item.time, completed: event.created },
          }),
          sessionID,
        )
      case "session.step.started": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        const completed =
          current && current.id !== event.data.assistantMessageID
            ? update(source, current.id, (item) =>
                item.type === "assistant"
                  ? { ...item, retry: undefined, time: { ...item.time, completed: event.created } }
                  : item,
              )
            : [...source]
        const existing = completed.find((item) => item.id === event.data.assistantMessageID)
        if (existing?.type === "assistant")
          return result(
            update(completed, existing.id, (item) =>
              item.type === "assistant"
                ? {
                    ...item,
                    agent: event.data.agent,
                    model: event.data.model,
                    retry: undefined,
                    error: undefined,
                    finish: undefined,
                    snapshot: event.data.snapshot ? { ...item.snapshot, start: event.data.snapshot } : item.snapshot,
                    time: { ...item.time, completed: undefined },
                  }
                : item,
            ),
            current && current.id !== existing.id ? [current.id, existing.id] : [existing.id],
          )
        return result(
          [
            ...completed,
            {
              id: event.data.assistantMessageID,
              type: "assistant",
              metadata: event.metadata,
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.created },
            },
          ],
          current ? [current.id, event.data.assistantMessageID] : [event.data.assistantMessageID],
        )
      }
      case "session.step.ended":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: event.data.finish,
          cost: event.data.cost,
          tokens: event.data.tokens,
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
              : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.step.failed":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: "error",
          error: event.data.error,
          retry: undefined,
          cost: event.data.cost ?? item.cost,
          tokens: event.data.tokens ?? item.tokens,
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
              : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.text.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "text", event.data.ordinal, { type: "text", text: "" }),
        }))
      case "session.text.delta":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: item.text + event.data.delta,
        }))
      case "session.text.ended":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: event.data.text,
        }))
      case "session.reasoning.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "reasoning", event.data.ordinal, {
            type: "reasoning",
            text: "",
            state: event.data.state,
            time: { created: event.created },
          }),
        }))
      case "session.reasoning.delta":
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          event.data.ordinal,
          (item) => ({
            ...item,
            text: item.text + event.data.delta,
          }),
        )
      case "session.reasoning.ended":
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          event.data.ordinal,
          (item) => ({
            ...item,
            text: event.data.text,
            state: event.data.state ?? item.state,
            time: { created: item.time?.created ?? event.created, completed: event.created },
          }),
        )
      case "session.tool.input.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: item.content.some((content) => content.type === "tool" && content.id === event.data.callID)
            ? item.content
            : [
                ...item.content,
                {
                  type: "tool",
                  id: event.data.callID,
                  name: event.data.name,
                  state: { status: "streaming", input: "" },
                  time: { created: event.created },
                },
              ],
        }))
      case "session.tool.input.delta":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming"
            ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
            : tool,
        )
      case "session.tool.input.ended":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: event.data.text } } : tool,
        )
      case "session.tool.called":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => ({
          ...tool,
          executed: event.data.executed,
          providerState: event.data.state,
          // structured: {}, content: []
          state: { status: "running", input: event.data.input, metadata: {} },
          time: { ...tool.time, ran: event.created },
        }))
      case "session.tool.progress":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "running"
            ? {
                ...tool,
                // state: { ...tool.state, structured: event.data.structured, content: event.data.content },
                state: { ...tool.state, metadata: event.data.metadata },
              }
            : tool,
        )
      case "session.tool.success":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "completed",
              input: tool.state.input,
              // structured: event.data.structured,
              metadata: event.data.metadata,
              content: event.data.content,
              // result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.tool.failed":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "error",
              input: typeof tool.state.input === "string" ? {} : tool.state.input,
              // structured: tool.state.status === "running" ? tool.state.structured : {},
              metadata: event.data.metadata ?? (tool.state.status === "running" ? tool.state.metadata : {}),
              content: event.data.content,
              error: event.data.error,
              // result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.retry.scheduled":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
        }))
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        if (!current?.retry) return result([...source])
        return updateAssistant(source, current.id, sessionID, (item) => ({ ...item, retry: undefined }))
      }
      case "session.compaction.started":
        return append({
          id: event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "running",
          metadata: event.metadata,
          reason: event.data.reason,
          summary: "",
          recent: event.data.recent,
          time: { created: event.created },
        })
      case "session.compaction.delta":
        return updateMessage<Extract<Compaction, { status: "running" }>>(
          source,
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
          (item) => ({
            ...item,
            summary: item.summary + event.data.text,
          }),
          sessionID,
        )
      case "session.compaction.ended": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
        )
        if (!current)
          return append({
            id: messageID(event.id),
            type: "compaction",
            status: "completed",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.created },
          })
        return result(
          update(source, current.id, () => ({
            ...current,
            status: "completed",
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
          })),
          [current.id],
        )
      }
      case "session.compaction.failed": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
        )
        const failed: Extract<Compaction, { status: "failed" }> = {
          id: current?.id ?? event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "failed",
          metadata: current?.metadata ?? event.metadata,
          reason: event.data.reason,
          error: event.data.error,
          time: current?.time ?? { created: event.created },
        }
        if (!current) return append(failed)
        return result(
          update(source, current.id, () => failed),
          [failed.id],
        )
      }
      default:
        return
    }
  }

  return {
    reduce,
    clear(sessionID: string) {
      for (const id of pending.keys()) {
        if (id.startsWith(`${sessionID}:`)) pending.delete(id)
      }
      for (const id of nativeOrdinals.keys()) {
        if (id.startsWith(`${sessionID}:`)) nativeOrdinals.delete(id)
      }
    },
  }
}

function adaptNativeSessionEvent(
  source: readonly SessionMessageInfo[],
  event: NativeSessionEvent,
  ordinals: Map<string, number>,
): OpenCodeEvent | undefined {
  const base = {
    id: event.id,
    created: event.data.timestamp,
    metadata: event.metadata,
    durable: event.durable,
    location: event.location,
  }
  switch (event.type) {
    case "session.next.step.started":
      return {
        ...base,
        type: "session.step.started",
        data: {
          sessionID: event.data.sessionID,
          assistantMessageID: event.data.assistantMessageID,
          agent: event.data.agent,
          model: event.data.model,
          snapshot: event.data.snapshot,
        },
      } as OpenCodeEvent
    case "session.next.step.ended":
      return {
        ...base,
        type: "session.step.ended",
        data: {
          sessionID: event.data.sessionID,
          assistantMessageID: event.data.assistantMessageID,
          finish: event.data.finish,
          cost: event.data.cost,
          tokens: event.data.tokens,
          snapshot: event.data.snapshot,
          files: event.data.files,
        },
      } as OpenCodeEvent
    case "session.next.step.failed":
      return {
        ...base,
        type: "session.step.failed",
        data: {
          sessionID: event.data.sessionID,
          assistantMessageID: event.data.assistantMessageID,
          error: event.data.error,
        },
      } as OpenCodeEvent
    case "session.next.text.started":
      return adaptNativePartStarted(source, event, "text", event.data.textID, ordinals)
    case "session.next.text.delta":
      return adaptNativePartUpdate(event, "text", event.data.textID, ordinals, { delta: event.data.delta })
    case "session.next.text.ended":
      return adaptNativePartUpdate(event, "text", event.data.textID, ordinals, { text: event.data.text })
    case "session.next.reasoning.started":
      return adaptNativePartStarted(source, event, "reasoning", event.data.reasoningID, ordinals, {
        state: event.data.providerMetadata,
      })
    case "session.next.reasoning.delta":
      return adaptNativePartUpdate(event, "reasoning", event.data.reasoningID, ordinals, {
        delta: event.data.delta,
      })
    case "session.next.reasoning.ended":
      return adaptNativePartUpdate(event, "reasoning", event.data.reasoningID, ordinals, {
        text: event.data.text,
        state: event.data.providerMetadata,
      })
    case "session.next.tool.input.started":
      return nativeToolEvent(event, "session.tool.input.started", {
        name: event.data.name,
      })
    case "session.next.tool.input.delta":
      return nativeToolEvent(event, "session.tool.input.delta", { delta: event.data.delta })
    case "session.next.tool.input.ended":
      return nativeToolEvent(event, "session.tool.input.ended", { text: event.data.text })
    case "session.next.tool.called":
      return nativeToolEvent(event, "session.tool.called", {
        input: event.data.input,
        executed: event.data.provider.executed,
        state: event.data.provider.metadata,
      })
    case "session.next.tool.progress":
      return nativeToolEvent(event, "session.tool.progress", { metadata: event.data.structured })
    case "session.next.tool.success":
      return nativeToolEvent(event, "session.tool.success", {
        content: event.data.content,
        metadata: event.data.structured,
        executed: event.data.provider.executed,
        resultState: event.data.provider.metadata,
      })
    case "session.next.tool.failed":
      return nativeToolEvent(event, "session.tool.failed", {
        error: event.data.error,
        executed: event.data.provider.executed,
        resultState: event.data.provider.metadata,
      })
    default:
      return
  }
}

function nativeSessionEvent(event: OpenCodeEvent | NativeSessionEvent) {
  if (!event.type.startsWith("session.next.")) return
  return event as NativeSessionEvent
}

function adaptNativePartStarted(
  source: readonly SessionMessageInfo[],
  event: Extract<NativeSessionEvent, { type: "session.next.text.started" | "session.next.reasoning.started" }>,
  type: "text" | "reasoning",
  partID: string,
  ordinals: Map<string, number>,
  extra: Readonly<Record<string, unknown>> = {},
) {
  const assistant = source.find(
    (item): item is Assistant => item.type === "assistant" && item.id === event.data.assistantMessageID,
  )
  const ordinal = assistant?.content.filter((item) => item.type === type).length ?? 0
  ordinals.set(nativePartKey(event.data.sessionID, event.data.assistantMessageID, type, partID), ordinal)
  return {
    id: event.id,
    created: event.data.timestamp,
    metadata: event.metadata,
    durable: event.durable,
    location: event.location,
    type: `session.${type}.started`,
    data: {
      sessionID: event.data.sessionID,
      assistantMessageID: event.data.assistantMessageID,
      ordinal,
      ...extra,
    },
  } as OpenCodeEvent
}

function adaptNativePartUpdate(
  event: Extract<
    NativeSessionEvent,
    {
      type:
        | "session.next.text.delta"
        | "session.next.text.ended"
        | "session.next.reasoning.delta"
        | "session.next.reasoning.ended"
    }
  >,
  type: "text" | "reasoning",
  partID: string,
  ordinals: Map<string, number>,
  extra: Readonly<Record<string, unknown>>,
) {
  const ordinal = ordinals.get(nativePartKey(event.data.sessionID, event.data.assistantMessageID, type, partID))
  if (ordinal === undefined) return
  const suffix = event.type.endsWith(".delta") ? "delta" : "ended"
  return {
    id: event.id,
    created: event.data.timestamp,
    metadata: event.metadata,
    durable: event.durable,
    location: event.location,
    type: `session.${type}.${suffix}`,
    data: {
      sessionID: event.data.sessionID,
      assistantMessageID: event.data.assistantMessageID,
      ordinal,
      ...extra,
    },
  } as OpenCodeEvent
}

function nativeToolEvent(
  event: Extract<NativeSessionEvent, { type: `session.next.tool.${string}` }>,
  type: string,
  extra: Readonly<Record<string, unknown>>,
) {
  return {
    id: event.id,
    created: event.data.timestamp,
    metadata: event.metadata,
    durable: event.durable,
    location: event.location,
    type,
    data: {
      sessionID: event.data.sessionID,
      assistantMessageID: event.data.assistantMessageID,
      callID: event.data.callID,
      ...extra,
    },
  } as OpenCodeEvent
}

function nativePartKey(sessionID: string, messageID: string, type: string, partID: string) {
  return `${sessionID}:${messageID}:${type}:${partID}`
}

function key(sessionID: string, inputID: string) {
  return `${sessionID}:${inputID}`
}

function messageID(eventID: string) {
  return eventID.replace(/^evt_/, "msg_")
}

function update(
  source: readonly SessionMessageInfo[],
  id: string,
  apply: (item: SessionMessageInfo) => SessionMessageInfo,
) {
  return source.map((item) => (item.id === id ? apply(item) : item))
}

function updateMessage<T extends SessionMessageInfo>(
  source: readonly SessionMessageInfo[],
  matches: (item: SessionMessageInfo) => item is T,
  apply: (item: T) => T,
  sessionID: string,
): V2SessionReduction {
  const current = source.findLast(matches)
  if (!current) return { sessionID, messages: [...source], touched: [] }
  return {
    sessionID,
    messages: update(source, current.id, (item) => (matches(item) ? apply(item) : item)),
    touched: [current.id],
  }
}

function updateAssistant(
  source: readonly SessionMessageInfo[],
  id: string,
  sessionID: string,
  apply: (item: Assistant) => Assistant,
): V2SessionReduction {
  return {
    sessionID,
    messages: update(source, id, (item) => (item.type === "assistant" ? apply(item) : item)),
    touched: source.some((item) => item.id === id && item.type === "assistant") ? [id] : [],
  }
}

function updateContent<T extends "text" | "reasoning">(
  source: readonly SessionMessageInfo[],
  messageID: string,
  sessionID: string,
  type: T,
  ordinal: number,
  apply: (
    item: Extract<Assistant["content"][number], { type: T }>,
  ) => Extract<Assistant["content"][number], { type: T }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => {
    let index = -1
    return {
      ...assistant,
      content: assistant.content.map((item) => {
        if (item.type !== type || ++index !== ordinal) return item
        return apply(item as Extract<Assistant["content"][number], { type: T }>)
      }),
    }
  })
}

function updateTool(
  source: readonly SessionMessageInfo[],
  messageID: string,
  callID: string,
  sessionID: string,
  apply: (
    item: Extract<Assistant["content"][number], { type: "tool" }>,
  ) => Extract<Assistant["content"][number], { type: "tool" }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => ({
    ...assistant,
    content: assistant.content.map((item) => (item.type === "tool" && item.id === callID ? apply(item) : item)),
  }))
}

function insertOrdinal<T extends Assistant["content"][number]["type"]>(
  source: Assistant["content"],
  type: T,
  ordinal: number,
  item: Extract<Assistant["content"][number], { type: T }>,
) {
  const matches = source.filter((content) => content.type === type)
  if (matches[ordinal]) return source
  return [...source, item]
}

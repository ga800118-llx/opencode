import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { AssistantMessage, Part, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import { groupParts, renderable, type PartGroup } from "@opencode-ai/session-ui/message-part"
import { TimelineRow, type AssistantProcessItem, type SummaryDiff } from "./timeline-row"
import { uniqueSummaryDiffs } from "./summary-diffs"

export { TimelineRow, type SummaryDiff } from "./timeline-row"

export type TimelineRowMap = {
  TurnGap: { userMessageID: string }
  CommentStrip: {
    userMessageID: string
  }
  UserMessage: {
    userMessageID: string
    anchor: boolean
  }
  TurnDivider: {
    userMessageID: string
    label: "compaction" | "interrupted"
  }
  AssistantPart: {
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
  }
  AssistantProcess: {
    userMessageID: string
    items: AssistantProcessItem[]
  }
  AssistantActivity: { userMessageID: string; tool?: string }
  Retry: { userMessageID: string }
  DiffSummary: { userMessageID: string; diffs: SummaryDiff[] }
  Error: { userMessageID: string; text: string }
}

export namespace Timeline {
  export function constructSessionMessageRows(
    messages: SessionMessageInfo[],
    getMessage: (messageID: string) => UserMessage | AssistantMessage | undefined,
    getMessageParts: (messageID: string) => Part[],
    showReasoning: boolean,
    status: SessionStatus["type"],
    inlineComments: boolean,
    projectedUserMessages: UserMessage[],
  ) {
    const turns: { user: UserMessage; assistants: AssistantMessage[] }[] = []
    const turnByUserID = new Map<string, (typeof turns)[number]>()
    messages.forEach((message) => {
      const projected = getMessage(message.id)
      if (message.type === "shell" && projected?.role === "user") {
        const assistant = getMessage(`${message.id}:assistant`)
        const turn = { user: projected, assistants: assistant?.role === "assistant" ? [assistant] : [] }
        turns.push(turn)
        turnByUserID.set(projected.id, turn)
        return
      }
      if (projected?.role === "user") {
        if (turnByUserID.has(projected.id)) return
        const turn = { user: projected, assistants: [] }
        turns.push(turn)
        turnByUserID.set(projected.id, turn)
        return
      }
      if (projected?.role !== "assistant") return
      const existing = turnByUserID.get(projected.parentID)
      if (existing) {
        existing.assistants.push(projected)
        return
      }
      const user = getMessage(projected.parentID)
      if (user?.role !== "user") return
      const turn = { user, assistants: [projected] }
      turns.push(turn)
      turnByUserID.set(user.id, turn)
    })
    const latestUserMessageID = turns.at(-1)?.user.id
    projectedUserMessages.forEach((user) => {
      if (turnByUserID.has(user.id)) return
      if (latestUserMessageID && user.id < latestUserMessageID) return
      const turn = { user, assistants: [] }
      turns.push(turn)
      turnByUserID.set(user.id, turn)
    })
    const activeMessageID = turns.at(-1)?.user.id
    return {
      activeMessageID,
      rows: turns.flatMap((turn, index) =>
        constructMessageRows(
          turn.user,
          getMessageParts,
          turn.assistants,
          index,
          showReasoning,
          status,
          turn.user.id === activeMessageID,
          inlineComments,
        ),
      ),
    }
  }

  export function constructMessageRows(
    userMessage: UserMessage,
    getMessageParts: (messageID: string) => Part[],
    assistantMessages: AssistantMessage[],
    index: number,
    showReasoning: boolean,
    status: SessionStatus["type"],
    isActive: boolean,
    // v2 renders comments inside the user message attachments row instead of a strip row
    inlineComments: boolean,
  ) {
    const rows: TimelineRow.TimelineRow[] = []

    const previousUserMessage = index > 0
    const userParts = getMessageParts(userMessage.id)
    const comments = userParts.flatMap((p) => MessageComment.fromPart(p) ?? [])
    const compaction = userParts.some((p) => p.type === "compaction")
    const interruptedMessageIndexes = assistantMessages.flatMap((message, messageIndex) =>
      message.error?.name === "MessageAbortedError" ? [messageIndex] : [],
    )
    const lastInterruptedMessageIndex = interruptedMessageIndexes.at(-1) ?? -1
    const error = assistantMessages.find((m) => m.error && m.error.name !== "MessageAbortedError")?.error

    const assistantPartRefs = assistantMessages.flatMap((message, messageIndex) =>
      getMessageParts(message.id)
        .filter((part) => part.type === "reasoning" || renderable(part, showReasoning))
        .map((part) => ({ messageID: message.id, messageIndex, part })),
    )
    const assistantItems: AssistantProcessItem[] =
      interruptedMessageIndexes.length > 0
        ? [
            ...interruptedMessageIndexes.flatMap((messageIndex, index) => [
              ...groupParts(
                assistantPartRefs.filter(
                  (ref) =>
                    ref.messageIndex > (interruptedMessageIndexes[index - 1] ?? -1) && ref.messageIndex <= messageIndex,
                ),
              ).map((group) => ({ type: "part" as const, group })),
              ...(compaction ? [] : [{ type: "interrupted" as const }]),
            ]),
            ...groupParts(assistantPartRefs.filter((ref) => ref.messageIndex > lastInterruptedMessageIndex)).map(
              (group) => ({
                type: "part" as const,
                group,
              }),
            ),
          ]
        : groupParts(assistantPartRefs).map((group) => ({ type: "part" as const, group }))
    const partByRef = new Map(assistantPartRefs.map((ref) => [`${ref.messageID}:${ref.part.id}`, ref.part] as const))
    const finalAnswerSourceStart =
      lastInterruptedMessageIndex === -1 ||
      assistantMessages.some((_, messageIndex) => messageIndex > lastInterruptedMessageIndex)
        ? lastInterruptedMessageIndex + 1
        : lastInterruptedMessageIndex
    const finalAnswerCandidates = groupParts(
      assistantPartRefs.filter((ref) => ref.messageIndex >= finalAnswerSourceStart),
    ).map((group) => ({ type: "part" as const, group }))
    const finalAnswerStart =
      finalAnswerCandidates.findLastIndex((item) => {
        if (item.group.type !== "part") return true
        return partByRef.get(`${item.group.ref.messageID}:${item.group.ref.partID}`)?.type !== "text"
      }) + 1
    const finalAnswerKeys = new Set(finalAnswerCandidates.slice(finalAnswerStart).map((item) => item.group.key))
    const processItems = assistantItems.filter(
      (item) => item.type === "interrupted" || !finalAnswerKeys.has(item.group.key),
    )
    const finalAnswerItems = assistantItems.filter(
      (item): item is Extract<AssistantProcessItem, { type: "part" }> =>
        item.type === "part" && finalAnswerKeys.has(item.group.key),
    )
    if (previousUserMessage) rows.push(new TimelineRow.TurnGap({ userMessageID: userMessage.id }))

    if (comments.length > 0 && !inlineComments)
      rows.push(
        new TimelineRow.CommentStrip({
          userMessageID: userMessage.id,
        }),
      )

    rows.push(
      new TimelineRow.UserMessage({
        userMessageID: userMessage.id,
        anchor: inlineComments || comments.length === 0,
      }),
    )

    if (compaction) {
      rows.push(
        new TimelineRow.TurnDivider({
          userMessageID: userMessage.id,
          label: "compaction",
        }),
      )
    }

    if (assistantMessages.length > 0 || (isActive && status === "busy")) {
      rows.push(
        new TimelineRow.AssistantProcess({
          userMessageID: userMessage.id,
          items: processItems,
        }),
      )
    }

    finalAnswerItems.forEach((item) => {
      rows.push(
        new TimelineRow.AssistantPart({
          userMessageID: userMessage.id,
          group: item.group,
          previousAssistantPart: true,
        }),
      )
    })

    if (isActive && status === "busy" && !error) {
      const activeParts = assistantMessages.flatMap((message) => getMessageParts(message.id))
      const activeTool = activeParts.findLast(
        (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
      )

      rows.push(
        new TimelineRow.AssistantActivity({
          userMessageID: userMessage.id,
          tool: activeTool?.type === "tool" ? activeTool.tool : undefined,
        }),
      )
    }

    if (isActive && status === "retry") rows.push(new TimelineRow.Retry({ userMessageID: userMessage.id }))

    const diffs = uniqueSummaryDiffs(userMessage.summary?.diffs)
    if (diffs.length > 0 && (status === "idle" || !isActive)) {
      rows.push(
        new TimelineRow.DiffSummary({
          userMessageID: userMessage.id,
          diffs,
        }),
      )
    }

    if (error) {
      const data = error.data?.message
      rows.push(
        new TimelineRow.Error({
          userMessageID: userMessage.id,
          text: unwrapErrorMessage(
            typeof data === "string" ? data : data === undefined || data === null ? "" : String(data),
          ),
        }),
      )
    }

    return rows
  }

  function unwrapErrorMessage(message: string) {
    const text = message.replace(/^Error:\s*/, "").trim()

    const parse = (value: string) => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return undefined
      }
    }

    const read = (value: string) => {
      const first = parse(value)
      if (typeof first !== "string") return first
      return parse(first.trim())
    }

    let json = read(text)

    if (json === undefined) {
      const start = text.indexOf("{")
      const end = text.lastIndexOf("}")
      if (start !== -1 && end > start) json = read(text.slice(start, end + 1))
    }

    if (!record(json)) return message

    const err = record(json.error) ? json.error : undefined
    if (err) {
      const type = typeof err.type === "string" ? err.type : undefined
      const msg = typeof err.message === "string" ? err.message : undefined
      if (type && msg) return `${type}: ${msg}`
      if (msg) return msg
      if (type) return type
      const code = typeof err.code === "string" ? err.code : undefined
      if (code) return code
    }

    const msg = typeof json.message === "string" ? json.message : undefined
    if (msg) return msg

    const reason = typeof json.error === "string" ? json.error : undefined
    if (reason) return reason

    return message
  }

  function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }
}

export namespace MessageComment {
  export type MessageComment = {
    path: string
    comment: string
    selection?: {
      startLine: number
      endLine: number
    }
  }

  export const fromPart = (part: Part): MessageComment | undefined => {
    if (part.type !== "text" || !part.synthetic) return
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return
    return {
      path: next.path,
      comment: next.comment,
      selection: next.selection
        ? {
            startLine: next.selection.startLine,
            endLine: next.selection.endLine,
          }
        : undefined,
    }
  }
}

export * as SessionCompaction from "./compaction"

import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@opencode-ai/llm"
import { Cause, DateTime, Effect, Exit, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
}

type ManualInput = Omit<Input, "request"> & { readonly inputID?: SessionMessage.ID }

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS },
  )
}

const select = (
  entries: readonly Entry[],
  tokens: number,
): { readonly head: string; readonly recent: string } | undefined => {
  const conversation = entries
    .filter((entry) => entry.message.type !== "compaction")
    .map((entry) => serialize(entry.message))
    .filter(Boolean)
  if (conversation.length === 0) return
  let total = 0
  let split = conversation.length
  let splitPrefix = ""
  let splitSuffix = ""
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index])
    if (next > tokens) {
      const remaining = Math.max(0, tokens - total) * 4
      if (remaining > 0) {
        splitPrefix = conversation[index].slice(0, -remaining)
        splitSuffix = conversation[index].slice(-remaining)
        split = index + 1
      }
      break
    }
    total = next
    split = index
  }
  return {
    head: [...conversation.slice(0, split), splitPrefix].filter(Boolean).join("\n\n"),
    recent: [splitSuffix, ...conversation.slice(split)].filter(Boolean).join("\n\n"),
  }
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) =>
  [
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
  ].join("\n\n")

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const compact = Effect.fn("SessionCompaction.compact")(function* (input: {
    readonly sessionID: SessionSchema.ID
    readonly model: Model
    readonly reason: SessionMessage.Compaction["reason"]
    readonly previousSummary?: string
    readonly context: readonly string[]
    readonly recent: string
    readonly output?: number
    readonly inputID?: SessionMessage.ID
  }) {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.output ?? input.model.route.defaults.limits?.output ?? 0
    const summaryPrompt = buildPrompt({ previousSummary: input.previousSummary, context: input.context })
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    if (Token.estimate(summaryPrompt) > context - summaryOutput) return false
    const messageID = input.inputID ?? SessionMessage.ID.create()
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          messageID,
          timestamp: yield* DateTime.now,
          reason: input.reason,
        })

        const chunks: string[] = []
        let failed = false
        const summarized = yield* restore(
          dependencies.llm
            .stream(
              LLM.request({
                model: input.model,
                messages: [Message.user(summaryPrompt)],
                tools: [],
                generation: { maxTokens: summaryOutput },
              }),
            )
            .pipe(
              Stream.runForEach((event) => {
                if (LLMEvent.is.providerError(event)) failed = true
                if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
                return Effect.void
              }),
              Effect.as(true),
              Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
            ),
        ).pipe(Effect.exit)
        if (Exit.isFailure(summarized)) {
          yield* dependencies.events.publish(SessionEvent.Compaction.Failed, {
            sessionID: input.sessionID,
            messageID,
            timestamp: yield* DateTime.now,
            reason: input.reason,
            error: {
              type: "unknown",
              message: Cause.hasInterrupts(summarized.cause) ? "Compaction was interrupted" : "Compaction failed",
            },
          })
          return yield* Effect.failCause(summarized.cause)
        }
        const summary = chunks.join("")
        if (summarized.value && !failed && summary.trim()) {
          yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
            sessionID: input.sessionID,
            messageID,
            timestamp: yield* DateTime.now,
            reason: input.reason,
            text: summary,
            recent: input.recent,
          })
          return true
        }
        yield* dependencies.events.publish(SessionEvent.Compaction.Failed, {
          sessionID: input.sessionID,
          messageID,
          timestamp: yield* DateTime.now,
          reason: input.reason,
          error: {
            type: "unknown",
            message: failed ? "Compaction provider failed" : "Compaction produced no summary",
          },
        })
        return false
      }),
    )
  })
  const compactSelected = Effect.fn("SessionCompaction.compactSelected")(function* (
    input: ManualInput & {
      readonly reason: SessionMessage.Compaction["reason"]
      readonly force: boolean
      readonly output?: number
    },
  ) {
    const selected = select(input.entries, config.tokens)
    if (!selected) return false
    const previousSummary = input.entries.find((entry) => entry.message.type === "compaction")?.message
    const hasHead = selected.head.length > 0
    if (!hasHead && previousSummary?.type !== "compaction" && !input.force) return false
    const summarizeRecent = input.force && !hasHead
    const previousRecent = previousSummary?.type === "compaction" ? previousSummary.recent : ""
    return yield* compact({
      sessionID: input.sessionID,
      model: input.model,
      reason: input.reason,
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: (summarizeRecent ? [previousRecent, selected.recent] : [previousRecent, selected.head]).filter(Boolean),
      recent: summarizeRecent ? "" : selected.recent,
      output: input.output,
      inputID: input.inputID,
    })
  })
  const compactAfterOverflow = Effect.fn("SessionCompaction.compactAfterOverflow")(function* (input: Input) {
    return yield* compactSelected({
      sessionID: input.sessionID,
      entries: input.entries,
      model: input.model,
      reason: "auto",
      force: false,
      output: input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0,
    })
  })
  const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
    return yield* compactSelected({ ...input, reason: "manual", force: true })
  })
  const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (input: Input) {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    if (
      estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) <=
      context - Math.max(output, config.buffer)
    )
      return false
    return yield* compactAfterOverflow(input)
  })
  return {
    compactIfNeeded,
    compactAfterOverflow,
    compactManual,
  }
}

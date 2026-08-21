export * as SessionTitle from "./title"

import { LLM, LLMClient, LLMEvent, Message, SystemPart } from "@opencode-ai/llm"
import { DateTime, Effect, Scope, Stream } from "effect"
import { AgentV2 } from "../agent"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MAX_TITLE_LENGTH = 50
const FALLBACK_SYSTEM =
  "Generate one concise conversation title in the user's language. Output only the title, with no explanation."

export const make = Effect.gen(function* () {
  const events = yield* EventV2.Service
  const llm = yield* LLMClient.Service
  const agents = yield* AgentV2.Service
  const models = yield* SessionRunnerModel.Service
  const store = yield* SessionStore.Service
  const scope = yield* Scope.Scope
  const active = new Set<SessionSchema.ID>()

  const generate = Effect.fn("SessionTitle.generate")(function* (
    session: SessionSchema.Info,
    message: SessionMessage.User,
  ) {
    const agent = yield* agents.select("title")
    const model = yield* models.resolve(agent.info?.model ? { ...session, model: agent.info.model } : session)
    const text = yield* llm
      .stream(
        LLM.request({
          model,
          system: [SystemPart.make(agent.info?.system ?? FALLBACK_SYSTEM)],
          messages: [Message.user(`Generate a title for this conversation:\n\n${sourceText(message)}`)],
          tools: [],
          toolChoice: "none",
        }),
      )
      .pipe(
        Stream.filter(LLMEvent.is.textDelta),
        Stream.map((event) => event.text),
        Stream.mkString,
        Effect.timeout("20 seconds"),
      )
    return cleanTitle(text)
  })

  const run = Effect.fn("SessionTitle.run")(function* (
    session: SessionSchema.Info,
    message: SessionMessage.User,
    fallback: string,
  ) {
    const generated = yield* generate(session, message).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Session title generation failed", {
          sessionID: session.id,
          cause: String(cause),
        }).pipe(Effect.as(undefined)),
      ),
    )
    const title = generated ?? fallback
    const current = yield* store.get(session.id)
    if (!current || current.title !== session.title) return
    yield* events.publish(SessionEvent.TitleGenerated, {
      sessionID: session.id,
      timestamp: yield* DateTime.now,
      previousTitle: session.title,
      title,
    })
  })

  const schedule = Effect.fn("SessionTitle.schedule")(function* (sessionID: SessionSchema.ID) {
    return yield* Effect.gen(function* () {
      if (active.has(sessionID)) return
      const session = yield* store.get(sessionID)
      if (!session || session.parentID || !DEFAULT_TITLE.test(session.title)) return
      const message = (yield* store.context(sessionID)).find(
        (message): message is SessionMessage.User => message.type === "user",
      )
      if (!message) return
      const fallback = cleanTitle(sourceText(message))
      if (!fallback) return
      active.add(sessionID)
      yield* run(session, message, fallback).pipe(
        Effect.ensuring(Effect.sync(() => active.delete(sessionID))),
        Effect.forkIn(scope),
      )
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Session title scheduling failed", { sessionID, cause: String(cause) }),
      ),
    )
  })

  return { schedule }
})

function sourceText(message: SessionMessage.User) {
  return [message.text, ...(message.files ?? []).map((file) => file.name).filter((name) => name !== undefined)]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanTitle(value: string) {
  const line = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
    ?.replace(/^#+\s*/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
  if (!line) return
  const characters = Array.from(line)
  if (characters.length <= MAX_TITLE_LENGTH) return line
  return characters.slice(0, MAX_TITLE_LENGTH - 3).join("") + "..."
}

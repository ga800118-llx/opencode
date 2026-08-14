import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Deferred, Effect, Fiber, Layer } from "effect"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const wakes: SessionV2.ID[] = []
let wakeGate: Deferred.Deferred<void> | undefined
let wakeStarted: Deferred.Deferred<void> | undefined
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: (sessionID) =>
      Effect.gen(function* () {
        wakes.push(sessionID)
        if (wakeStarted) yield* Deferred.succeed(wakeStarted, undefined)
        if (wakeGate) yield* Deferred.await(wakeGate)
      }),
    interrupt: () => Effect.void,
    handoff: (_sessionID, effect) => effect,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, execution],
    ],
  ),
)

describe("SessionV2.compact", () => {
  it.effect("durably admits and coalesces one pending compaction", () =>
    Effect.gen(function* () {
      wakes.length = 0
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const first = yield* session.compact({ sessionID: created.id })
      const second = yield* session.compact({ sessionID: created.id })

      expect(second.id).toBe(first.id)
      expect(first).toMatchObject({ type: "compaction", sessionID: created.id })
      expect(yield* SessionInput.pendingCompaction((yield* Database.Service).db, created.id)).toMatchObject({
        id: first.id,
      })
      expect(wakes).toEqual([created.id, created.id])
    }),
  )

  it.effect("orders every model call against the durable compaction barrier", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const created = yield* session.create({ location })

      expect(yield* SessionInput.claimModelCall(db, created.id)).toBe(true)
      const admitted = yield* session.compact({ sessionID: created.id })
      yield* SessionInput.releaseModelCall(created.id)

      expect(yield* SessionInput.claimModelCall(db, created.id)).toBe(false)
      expect(yield* SessionInput.claimModelCall(db, created.id, admitted.id)).toBe(true)
      yield* SessionInput.releaseModelCall(created.id)
    }),
  )

  it.effect("reconciles an exact retry and rejects an ID used by a prompt", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const inputID = SessionMessage.ID.create()
      const first = yield* session.compact({ id: inputID, sessionID: created.id })
      expect((yield* session.compact({ id: inputID, sessionID: created.id })).id).toBe(first.id)

      const other = yield* session.create({ location })
      const promptID = SessionMessage.ID.create()
      yield* session.prompt({
        id: promptID,
        sessionID: other.id,
        prompt: Prompt.make({ text: "Prompt owns this ID." }),
        resume: false,
      })
      expect(yield* session.compact({ id: promptID, sessionID: other.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.CompactionConflictError",
        inputID: promptID,
      })
    }),
  )

  it.effect("returns an immutable admission for exact retries after settlement", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })
      const inputID = SessionMessage.ID.create()
      const admitted = yield* session.compact({ id: inputID, sessionID: created.id })
      yield* events.publish(SessionEvent.Compaction.Started, {
        sessionID: created.id,
        messageID: inputID,
        timestamp: yield* DateTime.now,
        reason: "manual",
      })
      yield* events.publish(SessionEvent.Compaction.Ended, {
        sessionID: created.id,
        messageID: inputID,
        timestamp: yield* DateTime.now,
        reason: "manual",
        text: "summary",
        recent: "",
      })

      const retried = yield* session.compact({ id: inputID, sessionID: created.id })
      expect(retried).toEqual(admitted)
      expect(Object.hasOwn(retried, "handledSeq")).toBe(false)
    }),
  )

  it.effect("rejects a different explicit ID while a compaction is pending", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* session.compact({ id: SessionMessage.ID.create(), sessionID: created.id })
      const competingID = SessionMessage.ID.create()

      expect(yield* session.compact({ id: competingID, sessionID: created.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.CompactionConflictError",
        inputID: competingID,
      })
    }),
  )

  it.effect("finishes the wake boundary when compact is interrupted after admission", () =>
    Effect.gen(function* () {
      wakes.length = 0
      wakeGate = yield* Deferred.make<void>()
      wakeStarted = yield* Deferred.make<void>()
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const inputID = SessionMessage.ID.create()
      const compact = yield* session.compact({ id: inputID, sessionID: created.id }).pipe(Effect.forkChild)
      yield* Deferred.await(wakeStarted)
      const interruption = yield* Fiber.interrupt(compact).pipe(Effect.forkChild)

      expect(yield* SessionInput.pendingCompaction((yield* Database.Service).db, created.id)).toMatchObject({
        id: inputID,
      })
      yield* Deferred.succeed(wakeGate, undefined)
      yield* Fiber.join(interruption)
      expect(wakes).toEqual([created.id])
      wakeGate = undefined
      wakeStarted = undefined
    }),
  )

  it.effect("rolls back a racing admission for a different compaction ID", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })
      const first = yield* session.compact({ sessionID: created.id })
      const competingID = SessionMessage.ID.create()

      expect(
        yield* events
          .publish(SessionEvent.Compaction.Admitted, {
            inputID: competingID,
            sessionID: created.id,
            timestamp: yield* DateTime.now,
          })
          .pipe(Effect.exit),
      ).toMatchObject({ _tag: "Failure" })
      expect(yield* SessionInput.pendingCompaction((yield* Database.Service).db, created.id)).toMatchObject({
        id: first.id,
      })
      expect(
        (yield* session.history({ sessionID: created.id, limit: 50 })).events.filter(
          (event) => event.type === "session.next.compaction.admitted",
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("settles only the matching manual compaction barrier", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })
      const admitted = yield* session.compact({ sessionID: created.id })
      yield* events.publish(SessionEvent.Compaction.Failed, {
        sessionID: created.id,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        reason: "manual",
        error: { type: "unknown", message: "unrelated" },
      })
      expect(yield* SessionInput.pendingCompaction((yield* Database.Service).db, created.id)).toMatchObject({
        id: admitted.id,
      })

      yield* events.publish(SessionEvent.Compaction.Failed, {
        sessionID: created.id,
        messageID: admitted.id,
        timestamp: yield* DateTime.now,
        reason: "manual",
        error: { type: "unknown", message: "matched" },
      })
      expect(yield* SessionInput.pendingCompaction((yield* Database.Service).db, created.id)).toBeUndefined()
    }),
  )
})

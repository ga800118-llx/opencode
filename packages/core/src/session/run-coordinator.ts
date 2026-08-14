export * as SessionRunCoordinator from "./run-coordinator"

import { Cause, Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E> {
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
  /** Pauses new work, stops active execution, then restarts from current placement after the handoff. */
  readonly handoff: <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>) => Effect.Effect<A, E2, R>
}

type Entry<E> = {
  readonly done: Deferred.Deferred<Exit.Exit<void, E>>
  owner?: Fiber.Fiber<void, never>
  force: boolean
  handoffStopping: boolean
  pendingWake: boolean
  stopping: boolean
}

type Handoff<E> = {
  readonly next: Deferred.Deferred<Entry<E>>
  force: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const handoffs = new Map<Key, Handoff<E>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const makeEntry = (): Entry<E> => ({
      done: Deferred.makeUnsafe<Exit.Exit<void, E>>(),
      force: false,
      handoffStopping: false,
      pendingWake: false,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false) => {
      entry.force = force
      const ready = Deferred.makeUnsafe<void>()
      const owner = fork(
        (successor ? Effect.yieldNow : Deferred.await(ready)).pipe(
          Effect.andThen(Effect.suspend(() => options.drain(key, force))),
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      if (Exit.isSuccess(exit) && !entry.stopping && entry.pendingWake) {
        entry.pendingWake = false
        start(key, entry, false, true)
        return
      }

      const successor = entry.pendingWake ? makeEntry() : undefined
      if (successor === undefined) active.delete(key)
      else {
        active.set(key, successor)
        start(key, successor, false, true)
      }
      Deferred.doneUnsafe(entry.done, Effect.succeed(exit))
    }

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        const awaitEntry = (entry: Entry<E>) =>
          restore(Deferred.await(entry.done)).pipe(
            Effect.flatMap((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : entry.handoffStopping && Cause.hasInterruptsOnly(exit.cause)
                  ? restore(run(key))
                  : Effect.failCause(exit.cause),
            ),
          )
        const handoff = handoffs.get(key)
        if (handoff) {
          handoff.force = true
          return restore(Deferred.await(handoff.next)).pipe(Effect.flatMap(awaitEntry))
        }
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          return awaitEntry(entry)
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, true)
        return awaitEntry(next)
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        if (handoffs.has(key)) return
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.pendingWake = true
          return
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, false)
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        entry.stopping = true
        entry.pendingWake = false
        return Fiber.interrupt(entry.owner)
      })

    const interruptForHandoff = (key: Key, state: Handoff<E>): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        if (entry.force) state.force = true
        entry.stopping = true
        entry.handoffStopping = true
        entry.pendingWake = false
        return Fiber.interrupt(entry.owner)
      })

    const handoff = <A, E2, R>(key: Key, effect: Effect.Effect<A, E2, R>): Effect.Effect<A, E2, R> =>
      Effect.uninterruptibleMask((restore) => {
        const pending = handoffs.get(key)
        if (pending)
          return restore(Deferred.await(pending.next)).pipe(Effect.asVoid, Effect.andThen(handoff(key, effect)))
        const state: Handoff<E> = { next: Deferred.makeUnsafe<Entry<E>>(), force: false }
        handoffs.set(key, state)
        return interruptForHandoff(key, state).pipe(
          Effect.andThen(restore(effect)),
          Effect.ensuring(
            Effect.sync(() => {
              handoffs.delete(key)
              const next = makeEntry()
              active.set(key, next)
              start(key, next, state.force)
              Deferred.doneUnsafe(state.next, Effect.succeed(next))
            }),
          ),
        )
      })

    return { active: Effect.sync(() => new Set(active.keys())), run, wake, interrupt, handoff }
  })

import { describe, expect } from "bun:test"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"

function lock(dir: string, key: string) {
  return path.join(dir, Hash.fast(key) + ".lock")
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8"))
}

// ---------------------------------------------------------------------------
// Worker subprocess helpers
// ---------------------------------------------------------------------------

type Msg = {
  key: string
  dir: string
  holdMs?: number
  ready?: string
  active?: string
  done?: string
}

const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "../fixture/effect-flock-worker.ts")

function run(msg: Msg) {
  return new Promise<{ code: number; stdout: Buffer; stderr: Buffer }>((resolve) => {
    const proc = spawn(process.execPath, [worker, JSON.stringify(msg)], { cwd: root })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    proc.stdout?.on("data", (data) => stdout.push(Buffer.from(data)))
    proc.stderr?.on("data", (data) => stderr.push(Buffer.from(data)))
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
  })
}

function spawnWorker(msg: Msg) {
  return spawn(process.execPath, [worker, JSON.stringify(msg)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

async function stopWorker(proc: ReturnType<typeof spawnWorker>) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()))

  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    await closed
    return
  }

  await new Promise<void>((resolve) => {
    const killProc = spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"])
    killProc.on("close", () => {
      proc.kill()
      resolve()
    })
  })
  await closed
}

async function waitForFile(file: string, timeout = 3_000) {
  const stop = Date.now() + timeout
  while (Date.now() < stop) {
    if (await exists(file)) return
    await sleep(20)
  }
  throw new Error(`Timed out waiting for file: ${file}`)
}

// ---------------------------------------------------------------------------
// Test layer
// ---------------------------------------------------------------------------

const testGlobal = Global.layerWith({
  home: os.homedir(),
  data: os.tmpdir(),
  cache: os.tmpdir(),
  config: os.tmpdir(),
  state: os.tmpdir(),
  bin: os.tmpdir(),
  log: os.tmpdir(),
})

const testLayer = AppNodeBuilder.build(LayerNode.group([EffectFlock.node, FSUtil.node]), [[Global.node, testGlobal]])

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("util.effect-flock", () => {
  const it = testEffect(testLayer)

  it.live(
    "acquire and release via scoped Effect",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const lockDir = lock(dir, "eflock:acquire")

      yield* Effect.scoped(flock.acquire("eflock:acquire", dir))

      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "withLock data-first",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")

      let hit = false
      yield* flock.withLock(
        Effect.sync(() => {
          hit = true
        }),
        "eflock:df",
        dir,
      )
      expect(hit).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "withLock pipeable",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")

      let hit = false
      yield* Effect.sync(() => {
        hit = true
      }).pipe(flock.withLock("eflock:pipe", dir))
      expect(hit).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "interrupts a contender while another fiber holds the lock",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:interrupt-contender"
      const held = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempting = yield* Deferred.make<void>()
      const holder = yield* flock
        .withLock(Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))), key, dir)
        .pipe(Effect.forkScoped)
      yield* Deferred.await(held)
      const contender = yield* Deferred.succeed(attempting, undefined)
        .pipe(Effect.andThen(flock.withLock(Effect.void, key, dir)))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(attempting)
      yield* Effect.sleep("2 millis")

      yield* Fiber.interrupt(contender).pipe(Effect.timeout("100 millis"))
      const interrupted = yield* Fiber.await(contender)
      expect(Exit.isFailure(interrupted)).toBe(true)
      expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true)
      expect(yield* Effect.promise(() => exists(lock(dir, key)))).toBe(true)

      yield* Deferred.succeed(release, undefined)
      expect(Exit.isSuccess(yield* Fiber.await(holder))).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "writes owner metadata",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:meta"
      const lockDir = lock(dir, key)
      const file = path.join(lockDir, "meta.json")

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* flock.acquire(key, dir)
          const json = yield* Effect.promise(() =>
            readJson<{ token: string; pid?: unknown; hostname?: unknown; createdAt?: unknown }>(file),
          )
          expect(typeof json.token).toBe("string")
          expect(typeof json.pid).toBe("number")
          expect(typeof json.hostname).toBe("string")
          expect(typeof json.createdAt).toBe("string")
          expect(yield* Effect.promise(() => fs.readFile(path.join(lockDir, "heartbeat"), "utf8"))).toBe(json.token)
        }),
      )
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "cleans its owned lock after metadata disappears",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:missing-metadata"
      const lockDir = lock(dir, key)

      const result = yield* flock
        .withLock(
          Effect.promise(() => fs.rm(path.join(lockDir, "meta.json"))),
          key,
          dir,
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("metadata missing")
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)

      yield* flock.withLock(Effect.void, key, dir).pipe(Effect.timeout("1 second"))
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "preserves a lock when the heartbeat owner token does not match",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:mismatched-heartbeat"
      const lockDir = lock(dir, key)

      const result = yield* flock
        .withLock(
          Effect.promise(async () => {
            await fs.writeFile(path.join(lockDir, "heartbeat"), "another-owner")
            await fs.rm(path.join(lockDir, "meta.json"))
          }),
          key,
          dir,
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "preserves a new owner when an old release resumes after stale takeover",
    Effect.gen(function* () {
      const fsService = yield* FSUtil.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:release-takeover"
      const lockDir = lock(dir, key)
      const metaPath = path.join(lockDir, "meta.json")
      const firstRead = yield* Deferred.make<string>()
      const resumeRelease = yield* Deferred.make<void>()
      const secondAcquired = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const state = { bodyFinished: false, paused: false }
      const filesystem = FSUtil.Service.of({
        ...fsService,
        readFileString: (target) => {
          const read = fsService.readFileString(target)
          if (target !== metaPath || !state.bodyFinished || state.paused) return read
          state.paused = true
          return read.pipe(
            Effect.flatMap((content) =>
              Deferred.succeed(firstRead, content).pipe(
                Effect.andThen(Deferred.await(resumeRelease)),
                Effect.as(content),
              ),
            ),
          )
        },
      })
      const layer = Layer.fresh(
        AppNodeBuilder.build(EffectFlock.node, [
          [Global.node, testGlobal],
          [FSUtil.node, Layer.succeed(FSUtil.Service, filesystem)],
        ]),
      )
      const context = yield* Layer.build(layer)
      const flock = Context.get(context, EffectFlock.Service)

      const old = yield* flock
        .withLock(
          Effect.sync(() => {
            state.bodyFinished = true
          }),
          key,
          dir,
        )
        .pipe(Effect.forkScoped)
      const oldMeta = JSON.parse(yield* Deferred.await(firstRead).pipe(Effect.timeout("1 second"))) as {
        token: string
      }
      yield* Effect.promise(async () => {
        const stale = new Date(Date.now() - 120_000)
        await fs.utimes(lockDir, stale, stale)
        await fs.utimes(path.join(lockDir, "heartbeat"), stale, stale)
        await fs.utimes(metaPath, stale, stale)
      })

      const current = yield* flock
        .withLock(
          Deferred.succeed(secondAcquired, undefined).pipe(Effect.andThen(Deferred.await(releaseSecond))),
          key,
          dir,
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(secondAcquired).pipe(Effect.timeout("2 seconds"))
      const newMeta = yield* Effect.promise(() => readJson<{ token: string }>(metaPath))
      expect(newMeta.token).not.toBe(oldMeta.token)

      yield* Deferred.succeed(resumeRelease, undefined)
      const oldExit = yield* Fiber.await(old)
      expect(Exit.isFailure(oldExit)).toBe(true)
      expect(Exit.isFailure(oldExit) ? Cause.pretty(oldExit.cause) : "").toContain("owner changed")
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(true)
      expect((yield* Effect.promise(() => readJson<{ token: string }>(metaPath))).token).toBe(newMeta.token)

      yield* Deferred.succeed(releaseSecond, undefined)
      expect(Exit.isSuccess(yield* Fiber.await(current))).toBe(true)
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "does not remove a replacement breaker generation during release",
    Effect.gen(function* () {
      const fsService = yield* FSUtil.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:release-breaker-generation"
      const breaker = lock(dir, key) + ".breaker"
      const observed = yield* Deferred.make<string>()
      const resume = yield* Deferred.make<void>()
      const state = { bodyFinished: false, paused: false }
      const filesystem = FSUtil.Service.of({
        ...fsService,
        stat: (target) => {
          const result = fsService.stat(target)
          if (!state.bodyFinished || state.paused || path.dirname(target) !== breaker) return result
          state.paused = true
          return result.pipe(
            Effect.flatMap((info) =>
              Deferred.succeed(observed, target).pipe(Effect.andThen(Deferred.await(resume)), Effect.as(info)),
            ),
          )
        },
      })
      const layer = Layer.fresh(
        AppNodeBuilder.build(EffectFlock.node, [
          [Global.node, testGlobal],
          [FSUtil.node, Layer.succeed(FSUtil.Service, filesystem)],
        ]),
      )
      const context = yield* Layer.build(layer)
      const flock = Context.get(context, EffectFlock.Service)

      const owner = yield* flock
        .withLock(
          Effect.sync(() => {
            state.bodyFinished = true
          }),
          key,
          dir,
        )
        .pipe(Effect.forkScoped)
      const oldTokenPath = yield* Deferred.await(observed).pipe(Effect.timeout("1 second"))
      const newTokenPath = path.join(breaker, "replacement-generation")
      yield* Effect.promise(async () => {
        await fs.rm(breaker, { recursive: true })
        await fs.mkdir(breaker)
        await fs.writeFile(newTokenPath, "replacement-generation")
      })

      yield* Deferred.succeed(resume, undefined)
      expect(Exit.isSuccess(yield* Fiber.await(owner))).toBe(true)
      expect(yield* Effect.promise(() => exists(oldTokenPath))).toBe(false)
      expect(yield* Effect.promise(() => exists(newTokenPath))).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "does not remove a replacement breaker generation during stale cleanup",
    Effect.gen(function* () {
      const fsService = yield* FSUtil.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:stale-breaker-generation"
      const lockDir = lock(dir, key)
      const breaker = lockDir + ".breaker"
      const oldTokenPath = path.join(breaker, "stale-generation")
      const newTokenPath = path.join(breaker, "replacement-generation")
      const observed = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()
      const retried = yield* Deferred.make<void>()
      const state = { paused: false, reads: 0 }
      const filesystem = FSUtil.Service.of({
        ...fsService,
        stat: (target) => {
          const result = fsService.stat(target)
          if (target !== oldTokenPath || state.paused) return result
          state.paused = true
          return result.pipe(
            Effect.flatMap((info) =>
              Deferred.succeed(observed, undefined).pipe(Effect.andThen(Deferred.await(resume)), Effect.as(info)),
            ),
          )
        },
        readDirectory: (target) => {
          const result = fsService.readDirectory(target)
          if (target !== breaker) return result
          state.reads++
          if (state.reads !== 2) return result
          return result.pipe(Effect.tap(() => Deferred.succeed(retried, undefined)))
        },
      })
      const layer = Layer.fresh(
        AppNodeBuilder.build(EffectFlock.node, [
          [Global.node, testGlobal],
          [FSUtil.node, Layer.succeed(FSUtil.Service, filesystem)],
        ]),
      )
      const context = yield* Layer.build(layer)
      const flock = Context.get(context, EffectFlock.Service)

      yield* Effect.promise(async () => {
        await fs.mkdir(lockDir, { recursive: true })
        await fs.mkdir(breaker)
        await fs.writeFile(oldTokenPath, "stale-generation")
        const stale = new Date(Date.now() - 120_000)
        await fs.utimes(lockDir, stale, stale)
        await fs.utimes(breaker, stale, stale)
        await fs.utimes(oldTokenPath, stale, stale)
      })
      const contender = yield* flock.withLock(Effect.void, key, dir).pipe(Effect.forkScoped)
      yield* Deferred.await(observed).pipe(Effect.timeout("1 second"))
      yield* Effect.promise(async () => {
        await fs.rm(breaker, { recursive: true })
        await fs.mkdir(breaker)
        await fs.writeFile(newTokenPath, "replacement-generation")
      })

      yield* Deferred.succeed(resume, undefined)
      yield* Deferred.await(retried).pipe(Effect.timeout("2 seconds"))
      expect(yield* Effect.promise(() => exists(oldTokenPath))).toBe(false)
      expect(yield* Effect.promise(() => exists(newTokenPath))).toBe(true)

      yield* Effect.promise(async () => {
        await fs.rm(newTokenPath)
        await fs.rmdir(breaker)
      })
      expect(Exit.isSuccess(yield* Fiber.await(contender).pipe(Effect.timeout("2 seconds")))).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "retries release while another owner holds the breaker",
    Effect.gen(function* () {
      const fsService = yield* FSUtil.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:release-breaker-contention"
      const lockDir = lock(dir, key)
      const breaker = lockDir + ".breaker"
      const token = path.join(breaker, "other-owner")
      const attempted = yield* Deferred.make<void>()
      const filesystem = FSUtil.Service.of({
        ...fsService,
        makeDirectory: (target, options) =>
          fsService
            .makeDirectory(target, options)
            .pipe(Effect.tapError(() => (target === breaker ? Deferred.succeed(attempted, undefined) : Effect.void))),
      })
      const layer = Layer.fresh(
        AppNodeBuilder.build(EffectFlock.node, [
          [Global.node, testGlobal],
          [FSUtil.node, Layer.succeed(FSUtil.Service, filesystem)],
        ]),
      )
      const context = yield* Layer.build(layer)
      const flock = Context.get(context, EffectFlock.Service)

      const owner = yield* flock
        .withLock(
          Effect.promise(async () => {
            await fs.mkdir(breaker)
            await fs.writeFile(token, "other-owner")
          }),
          key,
          dir,
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(attempted).pipe(Effect.timeout("1 second"))
      yield* Effect.promise(async () => {
        await fs.rm(token)
        await fs.rmdir(breaker)
      })

      expect(Exit.isSuccess(yield* Fiber.await(owner).pipe(Effect.timeout("1 second")))).toBe(true)
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      yield* flock.withLock(Effect.void, key, dir).pipe(Effect.timeout("1 second"))
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "recovers an empty breaker after a transient EBUSY during release",
    Effect.gen(function* () {
      const fsService = yield* FSUtil.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:release-empty-breaker-busy"
      const lockDir = lock(dir, key)
      const breaker = lockDir + ".breaker"
      const calls = { value: 0 }
      const filesystem = FSUtil.Service.of({
        ...fsService,
        removeEmptyDirectory: (target) => {
          if (target !== breaker || calls.value > 0) return fsService.removeEmptyDirectory(target)
          calls.value++
          return Effect.fail(
            new FSUtil.FileSystemError({
              method: "removeEmptyDirectory",
              cause: Object.assign(new Error("transient busy"), { code: "EBUSY" }),
            }),
          )
        },
      })
      const layer = Layer.fresh(
        AppNodeBuilder.build(EffectFlock.node, [
          [Global.node, testGlobal],
          [FSUtil.node, Layer.succeed(FSUtil.Service, filesystem)],
        ]),
      )
      const context = yield* Layer.build(layer)
      const flock = Context.get(context, EffectFlock.Service)

      yield* flock
        .withLock(
          Effect.promise(() => fs.mkdir(breaker)),
          key,
          dir,
        )
        .pipe(Effect.timeout("1 second"))
      expect(calls.value).toBe(1)
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      expect(yield* Effect.promise(() => exists(breaker))).toBe(false)

      yield* flock.withLock(Effect.void, key, dir).pipe(Effect.timeout("1 second"))
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      expect(yield* Effect.promise(() => exists(breaker))).toBe(false)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "breaks stale lock dirs",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:stale"
      const lockDir = lock(dir, key)

      yield* Effect.promise(async () => {
        await fs.mkdir(lockDir, { recursive: true })
        const old = new Date(Date.now() - 120_000)
        await fs.utimes(lockDir, old, old)
      })

      let hit = false
      yield* flock.withLock(
        Effect.sync(() => {
          hit = true
        }),
        key,
        dir,
      )
      expect(hit).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "recovers from stale breaker",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:stale-breaker"
      const lockDir = lock(dir, key)
      const breaker = lockDir + ".breaker"

      yield* Effect.promise(async () => {
        await fs.mkdir(lockDir, { recursive: true })
        await fs.mkdir(breaker)
        const old = new Date(Date.now() - 120_000)
        await fs.utimes(lockDir, old, old)
        await fs.utimes(breaker, old, old)
      })

      let hit = false
      yield* flock.withLock(
        Effect.sync(() => {
          hit = true
        }),
        key,
        dir,
      )
      expect(hit).toBe(true)
      expect(yield* Effect.promise(() => exists(breaker))).toBe(false)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "detects compromise when lock dir removed",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:compromised"
      const lockDir = lock(dir, key)

      const result = yield* flock
        .withLock(
          Effect.promise(() => fs.rm(lockDir, { recursive: true, force: true })),
          key,
          dir,
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("missing")
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "detects token mismatch",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:token"
      const lockDir = lock(dir, key)
      const meta = path.join(lockDir, "meta.json")

      const result = yield* flock
        .withLock(
          Effect.promise(async () => {
            const json = await readJson<{ token?: string }>(meta)
            json.token = "tampered"
            await fs.writeFile(meta, JSON.stringify(json, null, 2))
          }),
          key,
          dir,
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("token mismatch")
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "fails on unwritable lock roots",
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")

      yield* Effect.promise(async () => {
        await fs.mkdir(dir, { recursive: true })
        await fs.chmod(dir, 0o500)
      })

      const result = yield* flock.withLock(Effect.void, "eflock:perm", dir).pipe(Effect.exit)
      // oxlint-disable-next-line no-base-to-string -- Exit has a useful toString for test assertions
      expect(String(result)).toContain("PermissionDenied")
      yield* Effect.promise(() => fs.chmod(dir, 0o700).then(() => fs.rm(tmp, { recursive: true, force: true })))
    }),
  )

  it.live(
    "enforces mutual exclusion under process contention",
    () =>
      Effect.promise(async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eflock-stress-"))
        const dir = path.join(tmp, "locks")
        const done = path.join(tmp, "done.log")
        const active = path.join(tmp, "active")
        const n = 16

        try {
          const out = await Promise.all(
            Array.from({ length: n }, () => run({ key: "eflock:stress", dir, done, active, holdMs: 30 })),
          )

          expect(out.map((x) => x.code)).toEqual(Array.from({ length: n }, () => 0))
          expect(out.map((x) => x.stderr.toString()).filter(Boolean)).toEqual([])

          const lines = (await fs.readFile(done, "utf8"))
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
          expect(lines.length).toBe(n)
        } finally {
          await fs.rm(tmp, { recursive: true, force: true })
        }
      }),
    60_000,
  )

  it.live(
    "recovers after a crashed lock owner",
    () =>
      Effect.promise(async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eflock-crash-"))
        const dir = path.join(tmp, "locks")
        const ready = path.join(tmp, "ready")

        const proc = spawnWorker({ key: "eflock:crash", dir, ready, holdMs: 120_000 })

        try {
          await waitForFile(ready, 5_000)
          await stopWorker(proc)

          // Backdate lock files so they're past STALE_MS (60s)
          const lockDir = lock(dir, "eflock:crash")
          const old = new Date(Date.now() - 120_000)
          await fs.utimes(lockDir, old, old).catch(() => {})
          await fs.utimes(path.join(lockDir, "heartbeat"), old, old).catch(() => {})
          await fs.utimes(path.join(lockDir, "meta.json"), old, old).catch(() => {})

          const done = path.join(tmp, "done.log")
          const result = await run({ key: "eflock:crash", dir, done, holdMs: 10 })
          expect(result.code).toBe(0)
          expect(result.stderr.toString()).toBe("")
        } finally {
          await stopWorker(proc).catch(() => {})
          await fs.rm(tmp, { recursive: true, force: true })
        }
      }),
    30_000,
  )
})

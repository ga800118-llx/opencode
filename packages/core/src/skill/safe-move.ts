export * as SkillSafeMove from "./safe-move"

import { constants } from "fs"
import os from "os"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import type { Scope } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export type PrepareInput = {
  readonly sourceRoot: string
  readonly source: string
  readonly trashRoot: string
  readonly staging: string
  readonly final: string
}

type FchmodHook = (descriptor: number, mode: number) => number | undefined

export type Hooks = {
  readonly beforeSourceRename?: Effect.Effect<void>
  readonly afterSourceRename?: Effect.Effect<void>
  readonly beforeFinalizeRename?: Effect.Effect<void>
  readonly afterFinalRename?: Effect.Effect<void>
  readonly beforeRollback?: Effect.Effect<void>
  readonly beforeStagingOpen?: Effect.Effect<void>
  readonly beforeStagingStat?: Effect.Effect<void>
  readonly probeLibrary?: () => Promise<string | undefined>
  readonly fchmod?: FchmodHook
}

export class SafeMoveError extends Schema.TaggedErrorClass<SafeMoveError>()("SkillSafeMove.Error", {
  reason: Schema.Literals(["not-found", "unsafe", "conflict", "io", "unsupported"]),
  detail: Schema.String,
  errno: Schema.optional(Schema.Number),
}) {
  override get message() {
    return `${this.detail}${this.errno === undefined ? "" : ` (errno ${this.errno})`}`
  }
}

export interface Handle {
  readonly target: string
  readonly stage: (metadata: string) => Effect.Effect<void, SafeMoveError>
  readonly move: Effect.Effect<void, SafeMoveError>
  readonly finalize: Effect.Effect<void, SafeMoveError>
  readonly rollback: Effect.Effect<void, SafeMoveError>
}

export interface Interface {
  readonly available: () => Effect.Effect<boolean>
  readonly prepare: (input: PrepareInput) => Effect.Effect<Handle, SafeMoveError, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SkillSafeMove") {}

type Identity = {
  readonly dev: bigint
  readonly ino: bigint
}

type Result<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly errno: number }

type Native = {
  readonly openAt: (directory: number, name: Buffer, flags: number, mode?: number) => Result<number>
  readonly makeDirectoryAt: (directory: number, name: Buffer, mode: number) => Result<void>
  readonly fchmod: (descriptor: number, mode: number) => Result<void>
  readonly stat: (descriptor: number, buffer: Buffer) => Result<void>
  readonly statAt: (directory: number, name: Buffer, buffer: Buffer) => Result<void>
  readonly rename: (fromDirectory: number, from: Buffer, toDirectory: number, to: Buffer) => Result<void>
  readonly unlinkAt: (directory: number, name: Buffer, flags: number) => Result<void>
  readonly write: (descriptor: number, content: Buffer) => Result<number>
  readonly sync: (descriptor: number) => Result<void>
  readonly closeDescriptor: (descriptor: number) => void
  readonly closeLibrary: () => void
}

type ChainEntry = {
  readonly descriptor: number
  readonly identity: Identity
  readonly parent?: number
  readonly name?: Buffer
}

type Chain = {
  readonly entries: ChainEntry[]
  readonly leaf: number
}

type Staging = {
  readonly descriptor: number
  readonly identity: Identity
  metadata?: Identity
}

type Capability = {
  readonly target: string
  readonly createStaging: () => void
  readonly openStaging: () => void
  readonly captureStaging: () => void
  readonly writeMetadata: (metadata: string) => void
  readonly validateMove: () => void
  readonly renameSource: () => void
  readonly verifySourceMove: () => void
  readonly validateFinalize: () => void
  readonly renameFinal: () => void
  readonly verifyFinal: () => void
  readonly rollback: () => void
  readonly close: () => void
}

const StatSize = 256
const CloseOnExec = process.platform === "darwin" ? 0x01000000 : 0x00080000
const OpenFlags = constants.O_RDONLY | constants.O_NOFOLLOW | CloseOnExec
const DirectoryFlags = OpenFlags | constants.O_DIRECTORY
const MetadataFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | CloseOnExec
const AtCurrentWorkingDirectory = process.platform === "darwin" ? -2 : -100
const AtSymlinkNoFollow = process.platform === "darwin" ? 0x0020 : 0x0100
const AtRemoveDirectory = process.platform === "darwin" ? 0x0080 : 0x0200
const RenameNoReplace = process.platform === "darwin" ? 0x0004 : 0x0001

const CommonSymbols = {
  openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
  mkdirat: { args: ["i32", "ptr", "u32"], returns: "i32" },
  fchmod: { args: ["i32", "u32"], returns: "i32" },
  fstat: { args: ["i32", "ptr"], returns: "i32" },
  fstatat: { args: ["i32", "ptr", "ptr", "i32"], returns: "i32" },
  unlinkat: { args: ["i32", "ptr", "i32"], returns: "i32" },
  write: { args: ["i32", "ptr", "u64"], returns: "i64" },
  fsync: { args: ["i32"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
} as const

const DarwinSymbols = {
  ...CommonSymbols,
  renameatx_np: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
  __error: { args: [], returns: "ptr" },
} as const

const LinuxSymbols = {
  ...CommonSymbols,
  renameat2: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
  __errno_location: { args: [], returns: "ptr" },
} as const

export function make(hooks: Hooks = {}): Interface {
  let probedLibrary: Promise<string | undefined> | undefined
  const probe = () => {
    probedLibrary ??= Promise.resolve()
      .then(() => (hooks.probeLibrary ? hooks.probeLibrary() : probeLibrary()))
      .catch(() => undefined)
    return probedLibrary
  }
  return Service.of({
    available: Effect.fn("SkillSafeMove.available")(function* () {
      return (yield* Effect.promise(probe)) !== undefined
    }),
    prepare: Effect.fn("SkillSafeMove.prepare")(function* (input) {
      const library = yield* Effect.promise(probe)
      if (library === undefined) {
        return yield* new SafeMoveError({ reason: "unsupported", detail: "atomic no-replace rename is unavailable" })
      }
      const capability = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => prepareCapability(input, library, hooks.fchmod),
          catch: normalizeError,
        }),
        (capability) => Effect.sync(capability.close),
      )
      const attempt = (operation: () => void) => Effect.try({ try: operation, catch: normalizeError })
      // POSIX cannot compare an inode and rename its directory entry atomically. Parent descriptors and
      // no-replace renames prevent path redirection and overwrites; the post-move identity check detects
      // a same-owner replacement in the syscall window and compensates without overwriting its source name.
      const move = Effect.uninterruptibleMask((restore) =>
        attempt(capability.validateMove).pipe(
          Effect.andThen(restore(hooks.beforeSourceRename ?? Effect.void)),
          Effect.andThen(attempt(capability.renameSource)),
          Effect.andThen(hooks.afterSourceRename ?? Effect.void),
          Effect.andThen(attempt(capability.verifySourceMove)),
        ),
      )
      const stage = (metadata: string) =>
        Effect.uninterruptibleMask((restore) =>
          attempt(capability.createStaging).pipe(
            Effect.andThen(restore(hooks.beforeStagingOpen ?? Effect.void)),
            Effect.andThen(attempt(capability.openStaging)),
            Effect.andThen(restore(hooks.beforeStagingStat ?? Effect.void)),
            Effect.andThen(attempt(capability.captureStaging)),
            Effect.andThen(attempt(() => capability.writeMetadata(metadata))),
          ),
        )
      const finalize = Effect.uninterruptibleMask((restore) =>
        attempt(capability.validateFinalize).pipe(
          Effect.andThen(restore(hooks.beforeFinalizeRename ?? Effect.void)),
          Effect.andThen(attempt(capability.renameFinal)),
          Effect.andThen(hooks.afterFinalRename ?? Effect.void),
          Effect.andThen(attempt(capability.verifyFinal)),
        ),
      )
      return {
        target: capability.target,
        stage,
        move,
        finalize,
        rollback: Effect.uninterruptible(
          (hooks.beforeRollback ?? Effect.void).pipe(Effect.andThen(attempt(capability.rollback))),
        ),
      }
    }),
  })
}

const layer = Layer.succeed(Service, make())

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

async function probeLibrary() {
  if (process.platform !== "darwin" && process.platform !== "linux") return undefined
  if (process.arch !== "x64" && process.arch !== "arm64") return undefined
  for (const candidate of libraryCandidates()) {
    if (await probeCandidate(candidate).catch(() => false)) return candidate
  }
  return undefined
}

async function probeCandidate(candidate: string) {
  const { mkdtemp, readFile, rm, stat, writeFile } = await import("fs/promises")
  let native: Native | undefined
  let directory: string | undefined
  let supported = false
  try {
    native = await openNative(candidate)
    directory = await mkdtemp(path.join(os.tmpdir(), "opencode-skill-move-"))
    const source = path.join(directory, "source")
    const destination = path.join(directory, "destination")
    await writeFile(source, "source")
    await writeFile(destination, "destination")
    const before = await stat(destination, { bigint: true })
    const renamed = native.rename(
      AtCurrentWorkingDirectory,
      cstring(source),
      AtCurrentWorkingDirectory,
      cstring(destination),
    )
    const after = await stat(destination, { bigint: true })
    supported =
      !renamed.ok &&
      (renamed.errno === os.constants.errno.EEXIST || renamed.errno === os.constants.errno.ENOTEMPTY) &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      (await readFile(source, "utf8")) === "source" &&
      (await readFile(destination, "utf8")) === "destination"
  } catch {
    supported = false
  }
  try {
    native?.closeLibrary()
  } catch {
    supported = false
  }
  try {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  } catch {
    supported = false
  }
  return supported
}

function libraryCandidates() {
  if (process.platform === "darwin") return ["/usr/lib/libSystem.B.dylib"]
  const architecture = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined
  return ["libc.so.6", ...(architecture ? [`libc.musl-${architecture}.so.1`, `/lib/ld-musl-${architecture}.so.1`] : [])]
}

async function openNative(libraryPath: string, fchmod?: FchmodHook): Promise<Native> {
  const { dlopen, read } = await import("bun:ffi")
  if (process.platform === "darwin") {
    const library = dlopen(libraryPath, DarwinSymbols)
    const errno = () => {
      const pointer = library.symbols.__error()
      if (pointer === null) throw new Error("__error returned a null pointer")
      return read.i32(pointer)
    }
    return {
      openAt: (directory, name, flags, mode = 0) => result(library.symbols.openat(directory, name, flags, mode), errno),
      makeDirectoryAt: (directory, name, mode) => unit(library.symbols.mkdirat(directory, name, mode), errno),
      fchmod: withFchmodHook(fchmod, (descriptor, mode) => unit(library.symbols.fchmod(descriptor, mode), errno)),
      stat: (descriptor, buffer) => unit(library.symbols.fstat(descriptor, buffer), errno),
      statAt: (directory, name, buffer) =>
        unit(library.symbols.fstatat(directory, name, buffer, AtSymlinkNoFollow), errno),
      rename: (fromDirectory, from, toDirectory, to) =>
        unit(library.symbols.renameatx_np(fromDirectory, from, toDirectory, to, RenameNoReplace), errno),
      unlinkAt: (directory, name, flags) => unit(library.symbols.unlinkat(directory, name, flags), errno),
      write: (descriptor, content) => numeric(library.symbols.write(descriptor, content, content.byteLength), errno),
      sync: (descriptor) => unit(library.symbols.fsync(descriptor), errno),
      closeDescriptor: (descriptor) => {
        library.symbols.close(descriptor)
      },
      closeLibrary: () => library.close(),
    }
  }

  const library = dlopen(libraryPath, LinuxSymbols)
  const errno = () => {
    const pointer = library.symbols.__errno_location()
    if (pointer === null) throw new Error("__errno_location returned a null pointer")
    return read.i32(pointer)
  }
  return {
    openAt: (directory, name, flags, mode = 0) => result(library.symbols.openat(directory, name, flags, mode), errno),
    makeDirectoryAt: (directory, name, mode) => unit(library.symbols.mkdirat(directory, name, mode), errno),
    fchmod: withFchmodHook(fchmod, (descriptor, mode) => unit(library.symbols.fchmod(descriptor, mode), errno)),
    stat: (descriptor, buffer) => unit(library.symbols.fstat(descriptor, buffer), errno),
    statAt: (directory, name, buffer) =>
      unit(library.symbols.fstatat(directory, name, buffer, AtSymlinkNoFollow), errno),
    rename: (fromDirectory, from, toDirectory, to) =>
      unit(library.symbols.renameat2(fromDirectory, from, toDirectory, to, RenameNoReplace), errno),
    unlinkAt: (directory, name, flags) => unit(library.symbols.unlinkat(directory, name, flags), errno),
    write: (descriptor, content) => numeric(library.symbols.write(descriptor, content, content.byteLength), errno),
    sync: (descriptor) => unit(library.symbols.fsync(descriptor), errno),
    closeDescriptor: (descriptor) => {
      library.symbols.close(descriptor)
    },
    closeLibrary: () => library.close(),
  }
}

function result(value: number, errno: () => number): Result<number> {
  if (value >= 0) return { ok: true, value }
  return { ok: false, errno: errno() }
}

function numeric(value: number | bigint, errno: () => number): Result<number> {
  const number = Number(value)
  if (number >= 0) return { ok: true, value: number }
  return { ok: false, errno: errno() }
}

function unit(value: number, errno: () => number): Result<void> {
  if (value === 0) return { ok: true, value: undefined }
  return { ok: false, errno: errno() }
}

function withFchmodHook(hook: FchmodHook | undefined, fallback: Native["fchmod"]): Native["fchmod"] {
  if (!hook) return fallback
  return (descriptor, mode) => {
    const errno = hook(descriptor, mode)
    return errno === undefined ? { ok: true, value: undefined } : { ok: false, errno }
  }
}

async function prepareCapability(input: PrepareInput, libraryPath: string, fchmod?: FchmodHook): Promise<Capability> {
  const native = await openNative(libraryPath, fchmod)
  const descriptors: number[] = []
  try {
    const source = resolveInput(input.sourceRoot, input.source)
    const sourceChain = openChain(native, path.dirname(source), descriptors)
    const trashChain = openChain(native, path.resolve(input.trashRoot), descriptors)
    const sourceName = cstring(path.basename(source))
    const stagingName = segment(input.staging)
    const finalName = segment(input.final)
    const metadataName = cstring("metadata.json")
    const payloadName = cstring("payload")
    const sourceIdentity = statAt(native, sourceChain.leaf, sourceName, "source entry disappeared")
    const sourceDescriptor = unwrap(
      native.openAt(sourceChain.leaf, sourceName, OpenFlags),
      "failed to open source entry without following links",
    )
    descriptors.push(sourceDescriptor)
    assertIdentity(
      sourceIdentity,
      statDescriptor(native, sourceDescriptor),
      "source entry identity changed while opening",
    )
    validateChain(native, sourceChain)
    validateChain(native, trashChain)
    assertMissing(native, trashChain.leaf, stagingName)
    assertMissing(native, trashChain.leaf, finalName)

    let provisional: Identity | undefined
    let stagingDescriptor: number | undefined
    let staging: Staging | undefined
    let payloadPresent = false
    let finalized = false

    const requireStaging = () => {
      if (!staging) throw new SafeMoveError({ reason: "io", detail: "recovery staging has not been created" })
      return staging
    }
    const requireStagingDescriptor = () => {
      if (stagingDescriptor === undefined) {
        throw new SafeMoveError({ reason: "io", detail: "recovery staging has not been opened" })
      }
      return stagingDescriptor
    }
    const validateSource = () => {
      validateChain(native, sourceChain)
      assertIdentity(
        sourceIdentity,
        statAt(native, sourceChain.leaf, sourceName, "source entry disappeared"),
        "source entry identity changed",
      )
      assertIdentity(sourceIdentity, statDescriptor(native, sourceDescriptor), "source descriptor identity changed")
    }
    const validateStagingDescriptor = () => {
      const current = requireStaging()
      assertIdentity(current.identity, statDescriptor(native, current.descriptor), "recovery staging identity changed")
      if (current.metadata === undefined) {
        throw new SafeMoveError({ reason: "io", detail: "recovery metadata was not completed" })
      }
      assertIdentity(
        current.metadata,
        statAt(native, current.descriptor, metadataName, "recovery metadata disappeared"),
        "recovery metadata identity changed",
      )
    }
    const validateRecord = (name: Buffer) => {
      const current = requireStaging()
      validateChain(native, trashChain)
      assertIdentity(
        current.identity,
        statAt(native, trashChain.leaf, name, "recovery record disappeared"),
        "recovery record identity changed",
      )
      validateStagingDescriptor()
      assertIdentity(
        sourceIdentity,
        statAt(native, current.descriptor, payloadName, "recovery payload disappeared"),
        "recovery payload identity changed",
      )
    }
    const ownedRecordName = () => {
      const expected = staging?.identity ?? provisional
      if (expected === undefined) return undefined
      const names = finalized ? [finalName, stagingName] : [stagingName, finalName]
      return names.find((name) => {
        const observed = tryStatAt(native, trashChain.leaf, name)
        return observed !== undefined && equalIdentity(expected, observed)
      })
    }
    const cleanupRecord = () => {
      const current = staging
      if (current) {
        const metadata = tryStatAt(native, current.descriptor, metadataName)
        if (metadata !== undefined && current.metadata !== undefined) {
          assertIdentity(current.metadata, metadata, "recovery metadata identity changed during cleanup")
          unwrap(native.unlinkAt(current.descriptor, metadataName, 0), "failed to remove recovery metadata")
        }
      }
      const name = ownedRecordName()
      if (name !== undefined) {
        unwrap(native.unlinkAt(trashChain.leaf, name, AtRemoveDirectory), "failed to remove recovery record")
      }
    }

    return {
      target: source,
      createStaging: () => {
        if (provisional !== undefined || stagingDescriptor !== undefined || staging !== undefined) {
          throw new SafeMoveError({ reason: "conflict", detail: "recovery staging already exists" })
        }
        validateSource()
        validateChain(native, trashChain)
        assertMissing(native, trashChain.leaf, stagingName)
        unwrap(native.makeDirectoryAt(trashChain.leaf, stagingName, 0o700), "failed to create recovery staging")
        provisional = statAt(native, trashChain.leaf, stagingName, "recovery staging disappeared after creation")
      },
      openStaging: () => {
        stagingDescriptor = unwrap(
          native.openAt(trashChain.leaf, stagingName, DirectoryFlags),
          "failed to open recovery staging",
        )
        descriptors.push(stagingDescriptor)
      },
      captureStaging: () => {
        const descriptor = requireStagingDescriptor()
        const stagingIdentity = statDescriptor(native, descriptor)
        if (provisional === undefined) {
          throw new SafeMoveError({ reason: "io", detail: "recovery staging identity was not captured" })
        }
        assertIdentity(provisional, stagingIdentity, "recovery staging identity changed while opening")
        assertIdentity(
          stagingIdentity,
          statAt(native, trashChain.leaf, stagingName, "recovery staging disappeared"),
          "recovery staging identity changed while opening",
        )
        staging = { descriptor, identity: stagingIdentity }
      },
      writeMetadata: (metadata) => {
        const current = requireStaging()
        const metadataDescriptor = unwrap(
          // Bun FFI does not reliably preserve variadic openat modes. Create conservatively, then enforce the
          // final owner-only read/write mode through fixed-arity fchmod on the held descriptor.
          native.openAt(current.descriptor, metadataName, MetadataFlags, 0o400),
          "failed to create recovery metadata",
        )
        try {
          current.metadata = statDescriptor(native, metadataDescriptor)
          const secured = native.fchmod(metadataDescriptor, 0o600)
          if (!secured.ok) {
            throw new SafeMoveError({
              reason: "io",
              detail: "failed to secure recovery metadata",
              errno: secured.errno,
            })
          }
          writeAll(native, metadataDescriptor, Buffer.from(metadata))
          unwrap(native.sync(metadataDescriptor), "failed to sync recovery metadata")
        } finally {
          native.closeDescriptor(metadataDescriptor)
        }
        validateStagingDescriptor()
      },
      validateMove: () => {
        validateSource()
        validateChain(native, trashChain)
        validateStagingDescriptor()
        assertIdentity(
          requireStaging().identity,
          statAt(native, trashChain.leaf, stagingName, "recovery staging disappeared"),
          "recovery staging identity changed",
        )
        assertMissing(native, requireStaging().descriptor, payloadName)
      },
      renameSource: () => {
        const current = requireStaging()
        unwrap(native.rename(sourceChain.leaf, sourceName, current.descriptor, payloadName), "atomic skill move failed")
        payloadPresent = true
      },
      verifySourceMove: () => {
        const current = requireStaging()
        const observed = statAt(native, current.descriptor, payloadName, "moved skill payload disappeared")
        if (!equalIdentity(sourceIdentity, observed)) {
          throw new SafeMoveError({ reason: "unsafe", detail: "moved skill identity did not match preparation" })
        }
        assertIdentity(sourceIdentity, statDescriptor(native, sourceDescriptor), "source descriptor identity changed")
      },
      validateFinalize: () => {
        if (!payloadPresent) throw new SafeMoveError({ reason: "io", detail: "recovery payload has not been moved" })
        assertMissing(native, trashChain.leaf, finalName)
        validateRecord(stagingName)
      },
      renameFinal: () => {
        requireStaging()
        unwrap(
          native.rename(trashChain.leaf, stagingName, trashChain.leaf, finalName),
          "atomic recovery finalization failed",
        )
        finalized = true
      },
      verifyFinal: () => {
        try {
          validateRecord(finalName)
        } catch (cause) {
          const original = normalizeError(cause)
          const current = requireStaging()
          const observed = tryStatAt(native, trashChain.leaf, finalName)
          if (observed === undefined || !equalIdentity(current.identity, observed)) throw original
          const restored = native.rename(trashChain.leaf, finalName, trashChain.leaf, stagingName)
          if (!restored.ok) {
            throw new SafeMoveError({
              reason: "io",
              detail: `${original.message}; recovery record rollback failed: ${syscallError("rollback failed", restored.errno).message}`,
              errno: restored.errno,
            })
          }
          assertIdentity(
            current.identity,
            statAt(native, trashChain.leaf, stagingName, "restored recovery staging disappeared"),
            "restored recovery staging identity changed",
          )
          finalized = false
          throw original
        }
      },
      rollback: () => {
        if (payloadPresent) {
          const current = requireStaging()
          assertIdentity(
            sourceIdentity,
            statAt(native, current.descriptor, payloadName, "recovery payload disappeared before rollback"),
            "recovery payload identity changed before rollback",
          )
          assertIdentity(sourceIdentity, statDescriptor(native, sourceDescriptor), "source descriptor identity changed")
          assertMissing(native, sourceChain.leaf, sourceName)
          unwrap(
            native.rename(current.descriptor, payloadName, sourceChain.leaf, sourceName),
            "atomic skill rollback failed",
          )
          assertIdentity(
            sourceIdentity,
            statAt(native, sourceChain.leaf, sourceName, "restored skill disappeared"),
            "restored skill identity changed",
          )
          payloadPresent = false
        }
        cleanupRecord()
      },
      close: () => closeAll(native, descriptors),
    }
  } catch (error) {
    closeAll(native, descriptors)
    throw error
  }
}

function resolveInput(root: string, relative: string) {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, relative)
  const relation = path.relative(resolvedRoot, target)
  if (
    relation.length === 0 ||
    path.isAbsolute(relation) ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    relative.includes("\0")
  ) {
    throw new SafeMoveError({ reason: "unsafe", detail: "path escapes its capability root" })
  }
  return target
}

function segment(value: string) {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new SafeMoveError({ reason: "unsafe", detail: "recovery record name is not a safe segment" })
  }
  return cstring(value)
}

function openChain(native: Native, absolute: string, descriptors: number[]): Chain {
  const root = unwrap(
    native.openAt(AtCurrentWorkingDirectory, cstring("/"), DirectoryFlags),
    "failed to open filesystem root",
  )
  descriptors.push(root)
  const entries: ChainEntry[] = [{ descriptor: root, identity: statDescriptor(native, root) }]
  path
    .resolve(absolute)
    .split(path.sep)
    .filter(Boolean)
    .forEach((value) => {
      const parent = entries.at(-1)!.descriptor
      const name = cstring(value)
      const observed = statAt(native, parent, name, "directory path disappeared")
      const descriptor = unwrap(
        native.openAt(parent, name, DirectoryFlags),
        "failed to open directory path without following links",
      )
      descriptors.push(descriptor)
      const identity = statDescriptor(native, descriptor)
      assertIdentity(observed, identity, "directory identity changed while opening")
      entries.push({ descriptor, identity, parent, name })
    })
  return { entries, leaf: entries.at(-1)!.descriptor }
}

function validateChain(native: Native, chain: Chain) {
  chain.entries.forEach((entry) => {
    assertIdentity(entry.identity, statDescriptor(native, entry.descriptor), "open directory identity changed")
    if (entry.parent === undefined || entry.name === undefined) return
    assertIdentity(
      entry.identity,
      statAt(native, entry.parent, entry.name, "directory path disappeared"),
      "directory path now identifies a different object",
    )
  })
}

function statDescriptor(native: Native, descriptor: number) {
  const buffer = Buffer.alloc(StatSize)
  unwrap(native.stat(descriptor, buffer), "failed to inspect open descriptor")
  return identity(buffer)
}

function statAt(native: Native, directory: number, name: Buffer, detail: string) {
  const buffer = Buffer.alloc(StatSize)
  unwrap(native.statAt(directory, name, buffer), detail)
  return identity(buffer)
}

function tryStatAt(native: Native, directory: number, name: Buffer) {
  const buffer = Buffer.alloc(StatSize)
  const result = native.statAt(directory, name, buffer)
  if (result.ok) return identity(buffer)
  if (result.errno === os.constants.errno.ENOENT) return undefined
  throw syscallError("failed to inspect directory entry", result.errno)
}

function identity(buffer: Buffer): Identity {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return {
    dev: process.platform === "darwin" ? BigInt(view.getUint32(0, true)) : view.getBigUint64(0, true),
    ino: view.getBigUint64(8, true),
  }
}

function equalIdentity(left: Identity, right: Identity) {
  return left.dev === right.dev && left.ino === right.ino
}

function assertIdentity(expected: Identity, actual: Identity, detail: string) {
  if (equalIdentity(expected, actual)) return
  throw new SafeMoveError({ reason: "unsafe", detail })
}

function assertMissing(native: Native, directory: number, name: Buffer) {
  const observed = tryStatAt(native, directory, name)
  if (observed === undefined) return
  throw new SafeMoveError({ reason: "conflict", detail: "destination already exists" })
}

function writeAll(native: Native, descriptor: number, content: Buffer) {
  let offset = 0
  while (offset < content.byteLength) {
    const written = unwrap(native.write(descriptor, content.subarray(offset)), "failed to write recovery metadata")
    if (written === 0) throw new SafeMoveError({ reason: "io", detail: "recovery metadata write made no progress" })
    offset += written
  }
}

function unwrap<A>(result: Result<A>, detail: string): A {
  if (result.ok) return result.value
  throw syscallError(detail, result.errno)
}

function syscallError(detail: string, errno: number) {
  if (errno === os.constants.errno.ENOENT) return new SafeMoveError({ reason: "not-found", detail, errno })
  if (errno === os.constants.errno.ELOOP || errno === os.constants.errno.ENOTDIR) {
    return new SafeMoveError({ reason: "unsafe", detail, errno })
  }
  if (errno === os.constants.errno.EEXIST || errno === os.constants.errno.ENOTEMPTY) {
    return new SafeMoveError({ reason: "conflict", detail, errno })
  }
  return new SafeMoveError({ reason: "io", detail, errno })
}

function normalizeError(cause: unknown) {
  return cause instanceof SafeMoveError
    ? cause
    : new SafeMoveError({ reason: "io", detail: cause instanceof Error ? cause.message : String(cause) })
}

function closeAll(native: Native, descriptors: readonly number[]) {
  descriptors.toReversed().forEach(native.closeDescriptor)
  native.closeLibrary()
}

function cstring(value: string) {
  return Buffer.from(`${value}\0`)
}

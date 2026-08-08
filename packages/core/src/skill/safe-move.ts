export * as SkillSafeMove from "./safe-move"

import { constants } from "fs"
import os from "os"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import type { Scope } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export type Input = {
  readonly sourceRoot: string
  readonly source: string
  readonly destinationRoot: string
  readonly destination: string
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
  readonly move: Effect.Effect<void, SafeMoveError>
  readonly rollback: Effect.Effect<void, SafeMoveError>
}

export interface Interface {
  readonly available: () => Effect.Effect<boolean>
  readonly open: (input: Input) => Effect.Effect<Handle, SafeMoveError, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SkillSafeMove") {}

type Identity = {
  readonly dev: bigint
  readonly ino: bigint
}

type Result<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly errno: number }

type Native = {
  readonly openAt: (directory: number, name: Buffer, flags: number) => Result<number>
  readonly stat: (descriptor: number, buffer: Buffer) => Result<void>
  readonly statAt: (directory: number, name: Buffer, buffer: Buffer) => Result<void>
  readonly rename: (fromDirectory: number, from: Buffer, toDirectory: number, to: Buffer) => Result<void>
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

type Capability = {
  readonly move: () => void
  readonly rollback: () => void
  readonly close: () => void
}

const StatSize = 256
const CloseOnExec = process.platform === "darwin" ? 0x01000000 : 0x00080000
const OpenFlags = constants.O_RDONLY | constants.O_NOFOLLOW | CloseOnExec
const DirectoryFlags = OpenFlags | constants.O_DIRECTORY
const AtCurrentWorkingDirectory = process.platform === "darwin" ? -2 : -100
const AtSymlinkNoFollow = process.platform === "darwin" ? 0x0020 : 0x0100
const RenameNoReplace = process.platform === "darwin" ? 0x0004 : 0x0001

const CommonSymbols = {
  openat: { args: ["i32", "ptr", "i32"], returns: "i32" },
  fstat: { args: ["i32", "ptr"], returns: "i32" },
  fstatat: { args: ["i32", "ptr", "ptr", "i32"], returns: "i32" },
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

let probedLibrary: Promise<string | undefined> | undefined

const layer = Layer.succeed(
  Service,
  Service.of({
    available: Effect.fn("SkillSafeMove.available")(function* () {
      probedLibrary ??= probeLibrary()
      return (yield* Effect.promise(() => probedLibrary!)) !== undefined
    }),
    open: Effect.fn("SkillSafeMove.open")(function* (input) {
      probedLibrary ??= probeLibrary()
      const library = yield* Effect.promise(() => probedLibrary!)
      if (library === undefined) {
        return yield* new SafeMoveError({ reason: "unsupported", detail: "atomic no-replace rename is unavailable" })
      }
      const capability = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => openCapability(input, library),
          catch: normalizeError,
        }),
        (capability) => Effect.sync(capability.close),
      )
      return {
        move: Effect.try({ try: capability.move, catch: normalizeError }),
        rollback: Effect.try({ try: capability.rollback, catch: normalizeError }),
      }
    }),
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

async function probeLibrary() {
  if (process.platform !== "darwin" && process.platform !== "linux") return undefined
  for (const candidate of libraryCandidates()) {
    const native = await openNative(candidate).catch(() => undefined)
    if (!native) continue
    try {
      const missing = cstring("")
      const result = native.rename(AtCurrentWorkingDirectory, missing, AtCurrentWorkingDirectory, missing)
      if (!result.ok && result.errno === os.constants.errno.ENOENT) return candidate
    } finally {
      native.closeLibrary()
    }
  }
  return undefined
}

function libraryCandidates() {
  if (process.platform === "darwin") return ["/usr/lib/libSystem.B.dylib"]
  const architecture = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined
  return ["libc.so.6", ...(architecture ? [`libc.musl-${architecture}.so.1`, `/lib/ld-musl-${architecture}.so.1`] : [])]
}

async function openNative(libraryPath: string): Promise<Native> {
  const { dlopen, read } = await import("bun:ffi")
  if (process.platform === "darwin") {
    const library = dlopen(libraryPath, DarwinSymbols)
    const errno = () => {
      const pointer = library.symbols.__error()
      if (pointer === null) throw new Error("__error returned a null pointer")
      return read.i32(pointer)
    }
    return {
      openAt: (directory, name, flags) => result(library.symbols.openat(directory, name, flags), errno),
      stat: (descriptor, buffer) => unit(library.symbols.fstat(descriptor, buffer), errno),
      statAt: (directory, name, buffer) =>
        unit(library.symbols.fstatat(directory, name, buffer, AtSymlinkNoFollow), errno),
      rename: (fromDirectory, from, toDirectory, to) =>
        unit(library.symbols.renameatx_np(fromDirectory, from, toDirectory, to, RenameNoReplace), errno),
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
    openAt: (directory, name, flags) => result(library.symbols.openat(directory, name, flags), errno),
    stat: (descriptor, buffer) => unit(library.symbols.fstat(descriptor, buffer), errno),
    statAt: (directory, name, buffer) =>
      unit(library.symbols.fstatat(directory, name, buffer, AtSymlinkNoFollow), errno),
    rename: (fromDirectory, from, toDirectory, to) =>
      unit(library.symbols.renameat2(fromDirectory, from, toDirectory, to, RenameNoReplace), errno),
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

function unit(value: number, errno: () => number): Result<void> {
  if (value === 0) return { ok: true, value: undefined }
  return { ok: false, errno: errno() }
}

async function openCapability(input: Input, libraryPath: string): Promise<Capability> {
  const native = await openNative(libraryPath)
  const descriptors: number[] = []
  try {
    const source = resolveInput(input.sourceRoot, input.source)
    const destination = resolveInput(input.destinationRoot, input.destination)
    const sourceChain = openChain(native, path.dirname(source), descriptors)
    const destinationChain = openChain(native, path.dirname(destination), descriptors)
    const sourceName = cstring(path.basename(source))
    const destinationName = cstring(path.basename(destination))
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
    assertMissing(native, destinationChain.leaf, destinationName)

    const validateSource = () => {
      validateChain(native, sourceChain)
      assertIdentity(
        sourceIdentity,
        statAt(native, sourceChain.leaf, sourceName, "source entry disappeared"),
        "source entry identity changed",
      )
      assertIdentity(sourceIdentity, statDescriptor(native, sourceDescriptor), "source descriptor identity changed")
    }
    const validateDestination = () => validateChain(native, destinationChain)

    return {
      move: () => {
        validateSource()
        validateDestination()
        assertMissing(native, destinationChain.leaf, destinationName)
        unwrap(
          native.rename(sourceChain.leaf, sourceName, destinationChain.leaf, destinationName),
          "atomic skill move failed",
        )
      },
      rollback: () => {
        validateChain(native, sourceChain)
        validateDescriptors(native, destinationChain)
        assertIdentity(
          sourceIdentity,
          statAt(native, destinationChain.leaf, destinationName, "recovery payload disappeared"),
          "recovery payload identity changed",
        )
        assertIdentity(sourceIdentity, statDescriptor(native, sourceDescriptor), "source descriptor identity changed")
        assertMissing(native, sourceChain.leaf, sourceName)
        unwrap(
          native.rename(destinationChain.leaf, destinationName, sourceChain.leaf, sourceName),
          "atomic skill rollback failed",
        )
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
    .forEach((segment) => {
      const parent = entries.at(-1)!.descriptor
      const name = cstring(segment)
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

function validateDescriptors(native: Native, chain: Chain) {
  chain.entries.forEach((entry) =>
    assertIdentity(entry.identity, statDescriptor(native, entry.descriptor), "open directory identity changed"),
  )
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

function identity(buffer: Buffer): Identity {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return {
    dev: process.platform === "darwin" ? BigInt(view.getUint32(0, true)) : view.getBigUint64(0, true),
    ino: view.getBigUint64(8, true),
  }
}

function assertIdentity(expected: Identity, actual: Identity, detail: string) {
  if (expected.dev === actual.dev && expected.ino === actual.ino) return
  throw new SafeMoveError({ reason: "unsafe", detail })
}

function assertMissing(native: Native, directory: number, name: Buffer) {
  const result = native.statAt(directory, name, Buffer.alloc(StatSize))
  if (!result.ok && result.errno === os.constants.errno.ENOENT) return
  if (result.ok) throw new SafeMoveError({ reason: "conflict", detail: "destination already exists" })
  throw syscallError("failed to inspect destination", result.errno)
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

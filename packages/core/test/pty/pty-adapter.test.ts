import { describe, expect, test } from "bun:test"
import { retainEarlyEvents, type Exit, type Proc } from "../../src/pty/pty"

describe("PTY process adapter", () => {
  test("replays output and exit events emitted before consumers subscribe", () => {
    const source = createSource()
    const proc = retainEarlyEvents(source.proc)

    source.data("early output")
    source.exit({ exitCode: 7 })

    const output: string[] = []
    const exits: Exit[] = []
    proc.onData((chunk) => output.push(chunk))
    proc.onExit((event) => exits.push(event))

    expect(output).toEqual(["early output"])
    expect(exits).toEqual([{ exitCode: 7 }])
  })

  test("delivers live events once and honors consumer disposal", () => {
    const source = createSource()
    const proc = retainEarlyEvents(source.proc)
    const output: string[] = []
    const exits: Exit[] = []
    const data = proc.onData((chunk) => output.push(chunk))
    const exit = proc.onExit((event) => exits.push(event))

    source.data("live")
    data.dispose()
    source.data("ignored")
    exit.dispose()
    source.exit({ exitCode: 0 })

    expect(output).toEqual(["live"])
    expect(exits).toEqual([])
  })
})

function createSource() {
  const listeners = {
    data: undefined as ((data: string) => void) | undefined,
    exit: undefined as ((event: Exit) => void) | undefined,
  }
  const proc: Proc = {
    pid: 1,
    onData(listener) {
      listeners.data = listener
      return { dispose() {} }
    },
    onExit(listener) {
      listeners.exit = listener
      return { dispose() {} }
    },
    write() {},
    resize() {},
    kill() {},
  }
  return {
    proc,
    data(chunk: string) {
      listeners.data?.(chunk)
    },
    exit(event: Exit) {
      listeners.exit?.(event)
    },
  }
}

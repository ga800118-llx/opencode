export type Disp = {
  dispose(): void
}

export type Exit = {
  exitCode: number
  signal?: number | string
}

export type Opts = {
  name: string
  cols?: number
  rows?: number
  cwd?: string
  env?: Record<string, string>
}

export type Proc = {
  pid: number
  onData(listener: (data: string) => void): Disp
  onExit(listener: (event: Exit) => void): Disp
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export function retainEarlyEvents(proc: Proc): Proc {
  const state = {
    data: new Set<(data: string) => void>(),
    exits: new Set<(event: Exit) => void>(),
    pending: [] as string[],
    exit: undefined as Exit | undefined,
  }

  proc.onData((chunk) => {
    if (state.data.size === 0) {
      state.pending.push(chunk)
      return
    }
    for (const listener of state.data) listener(chunk)
  })
  proc.onExit((event) => {
    state.exit = event
    for (const listener of state.exits) listener(event)
    state.exits.clear()
  })

  return {
    pid: proc.pid,
    onData(listener) {
      state.data.add(listener)
      for (const chunk of state.pending) listener(chunk)
      state.pending.length = 0
      return {
        dispose() {
          state.data.delete(listener)
        },
      }
    },
    onExit(listener) {
      if (state.exit) {
        listener(state.exit)
        return { dispose() {} }
      }
      state.exits.add(listener)
      return {
        dispose() {
          state.exits.delete(listener)
        },
      }
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      proc.kill(signal)
    },
  }
}

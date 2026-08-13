import * as pty from "@lydell/node-pty"
import { retainEarlyEvents, type Opts, type Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const proc = pty.spawn(file, args, {
    ...opts,
    ...(process.platform === "win32" ? { useConptyDll: true } : {}),
  })
  return retainEarlyEvents({
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
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
  })
}

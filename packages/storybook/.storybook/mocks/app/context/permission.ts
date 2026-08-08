import { createSignal } from "solid-js"

type PermissionMode = "restricted" | "standard" | "auto"

const accepted = new Set<string>()
const [modes, setModes] = createSignal<Record<string, PermissionMode>>({})
const [confirmed, setConfirmed] = createSignal<Set<string>>(new Set())

function key(sessionID: string, directory?: string) {
  return `${directory ?? ""}:${sessionID}`
}

function modeKey(sessionID: string | undefined, directory: string) {
  return `${directory}:${sessionID ?? "project"}`
}

export function usePermission() {
  return {
    autoResponds() {
      return false
    },
    supportsModes() {
      return true
    },
    projectMode(directory: string) {
      return modes()[modeKey(undefined, directory)] ?? "standard"
    },
    mode(sessionID: string | undefined, directory: string) {
      return modes()[modeKey(sessionID, directory)] ?? modes()[modeKey(undefined, directory)] ?? "standard"
    },
    async setMode(input: { sessionID?: string; directory: string; mode: PermissionMode }) {
      setModes((current) => ({
        ...current,
        [modeKey(undefined, input.directory)]: input.mode,
        ...(input.sessionID ? { [modeKey(input.sessionID, input.directory)]: input.mode } : {}),
      }))
    },
    autoConfirmed(directory: string) {
      return confirmed().has(directory)
    },
    confirmAuto(directory: string) {
      setConfirmed((current) => new Set(current).add(directory))
    },
    isAutoAccepting(sessionID: string, directory?: string) {
      return accepted.has(key(sessionID, directory))
    },
    isAutoAcceptingDirectory() {
      return false
    },
    toggleAutoAccept(sessionID: string, directory?: string) {
      const next = key(sessionID, directory)
      if (accepted.has(next)) {
        accepted.delete(next)
        return
      }
      accepted.add(next)
    },
  }
}

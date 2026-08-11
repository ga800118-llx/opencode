import { createSignal } from "solid-js"

export type SessionCompactionRequest = {
  sessionID: string
  model: {
    providerID: string
    modelID: string
  }
}

export type SessionCompactionDisabledReason = "no-session" | "no-user-message" | "no-model" | "working" | "pending"

export type SessionCompactionResult =
  | { status: "success" }
  | { status: "disabled"; reason: Exclude<SessionCompactionDisabledReason, "pending"> }
  | { status: "error"; error: unknown }

export function sessionCompactionDescriptionKey(reason: SessionCompactionDisabledReason | undefined) {
  if (reason === "no-session") return "context.compact.disabled.noSession" as const
  if (reason === "no-user-message") return "context.compact.disabled.noUserMessage" as const
  if (reason === "no-model") return "toast.model.none.description" as const
  if (reason === "working") return "context.compact.disabled.working" as const
  if (reason === "pending") return "context.compact.disabled.pending" as const
  return "command.session.compact.description" as const
}

const inflight = new Map<string, Promise<SessionCompactionResult>>()
const [inflightVersion, setInflightVersion] = createSignal(0)

export function createSessionCompaction(input: {
  sessionID: () => string | undefined
  hasVisibleUserMessage: () => boolean
  model: () => { providerID: string; modelID: string } | undefined
  working: () => boolean
  compact: (request: SessionCompactionRequest) => Promise<unknown>
}) {
  const pending = () => {
    inflightVersion()
    const sessionID = input.sessionID()
    return !!sessionID && inflight.has(sessionID)
  }

  const disabledReason = (): SessionCompactionDisabledReason | undefined => {
    const sessionID = input.sessionID()
    if (!sessionID) return "no-session"
    if (pending()) return "pending"
    if (!input.hasVisibleUserMessage()) return "no-user-message"
    if (!input.model()) return "no-model"
    if (input.working()) return "working"
  }

  const run = async (): Promise<SessionCompactionResult> => {
    const sessionID = input.sessionID()
    if (!sessionID) return { status: "disabled", reason: "no-session" }

    const active = inflight.get(sessionID)
    if (active) return active
    if (!input.hasVisibleUserMessage()) return { status: "disabled", reason: "no-user-message" }

    const model = input.model()
    if (!model) return { status: "disabled", reason: "no-model" }
    if (input.working()) return { status: "disabled", reason: "working" }

    const request = Promise.resolve()
      .then(() => input.compact({ sessionID, model }))
      .then(() => ({ status: "success" }) as const)
      .catch((error: unknown) => ({ status: "error", error }) as const)
      .finally(() => {
        if (inflight.get(sessionID) !== request) return
        inflight.delete(sessionID)
        setInflightVersion((value) => value + 1)
      })

    inflight.set(sessionID, request)
    setInflightVersion((value) => value + 1)
    return request
  }

  return { pending, disabledReason, run }
}

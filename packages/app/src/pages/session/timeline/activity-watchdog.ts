export type SessionActivityState = "idle" | "active" | "slow" | "unverified"

export function projectActivity(input: {
  working: boolean
  now: number
  lastActivityAt: number
  toolRunning: boolean
}): SessionActivityState {
  if (!input.working) return "idle"
  if (input.toolRunning) return "active"
  const idle = Math.max(0, input.now - input.lastActivityAt)
  if (idle < 3 * 60_000) return "active"
  if (idle < 10 * 60_000) return "slow"
  return "unverified"
}

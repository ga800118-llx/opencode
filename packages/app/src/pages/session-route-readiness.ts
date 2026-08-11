export type SessionRouteReadinessResult = "ready" | "redirecting" | "failed"

export async function resolveSessionRouteReadiness(input: {
  mode: "legacy" | "draft"
  prepare: () => Promise<"ready" | "degraded" | undefined>
  newDraft: () => Promise<unknown | undefined>
}): Promise<SessionRouteReadinessResult> {
  if (input.mode === "draft") return (await input.newDraft()) ? "redirecting" : "failed"
  return (await input.prepare()) ? "ready" : "failed"
}

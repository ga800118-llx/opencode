export type ProductModelReadiness = "loading" | "ready" | "setup-required" | "desktop-unavailable"

export type ProductModelReadinessInput = {
  readonly providersLoading: boolean
  readonly hasUsableSelectedModel: boolean
  readonly availableModelCount: number
  readonly desktopModelCenterAvailable: boolean
}

export function modelReadiness(input: ProductModelReadinessInput): ProductModelReadiness {
  if (input.providersLoading) return "loading"
  if (input.hasUsableSelectedModel || input.availableModelCount > 0) return "ready"
  if (!input.desktopModelCenterAvailable) return "desktop-unavailable"
  return "setup-required"
}

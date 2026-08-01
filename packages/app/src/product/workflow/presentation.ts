export type ProductPresentationMode = "simple" | "advanced"

export type ProductPresentationState =
  | { readonly mode: "simple"; readonly simple: true; readonly advanced: false }
  | { readonly mode: "advanced"; readonly simple: false; readonly advanced: true }

const presentations = Object.freeze({
  simple: Object.freeze({ mode: "simple", simple: true, advanced: false }),
  advanced: Object.freeze({ mode: "advanced", simple: false, advanced: true }),
}) satisfies Readonly<Record<ProductPresentationMode, ProductPresentationState>>

export function normalizePresentationMode(value: unknown): ProductPresentationMode {
  return value === "advanced" ? "advanced" : "simple"
}

export function createPresentationState(value: unknown): ProductPresentationState {
  return presentations[normalizePresentationMode(value)]
}

import { normalizeProductError, type ProductErrorKind } from "@opencode-ai/app/product/errors"
import type { ProductModelDiagnostic } from "@opencode-ai/app/product/model-center"

export function createProbeDiagnostic(
  error: unknown,
  requestID: string,
  fallbackKind?: Extract<ProductErrorKind, "streaming" | "tool-calling">,
): ProductModelDiagnostic {
  const normalized = normalizeProductError(error)
  const fallback =
    normalized.kind === "unknown" && fallbackKind
      ? normalizeProductError({ code: fallbackKind === "streaming" ? "SSE_ERROR" : "TOOL_CALL_ERROR" })
      : normalized
  return Object.freeze({
    kind: fallback.kind,
    message: fallback.message,
    requestID,
    ...(normalized.diagnostic?.status === undefined ? {} : { status: normalized.diagnostic.status }),
    detail: fallback.action,
  })
}

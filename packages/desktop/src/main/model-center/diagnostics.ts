import { normalizeProductError } from "@opencode-ai/app/product/errors"
import type { ProductModelDiagnostic } from "@opencode-ai/app/product/model-center"

export function createProbeDiagnostic(error: unknown, requestID: string): ProductModelDiagnostic {
  const normalized = normalizeProductError(error)
  return Object.freeze({
    kind: normalized.kind,
    message: normalized.message,
    requestID,
    ...(normalized.diagnostic?.status === undefined ? {} : { status: normalized.diagnostic.status }),
    detail: normalized.action,
  })
}

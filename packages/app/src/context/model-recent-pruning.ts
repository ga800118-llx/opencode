import { pruneModelKeys, type ModelKey } from "./model-selection"

export function createRecentModelPruner(input: {
  persistedReady: () => boolean
  catalogReady: () => boolean
  recent: () => readonly ModelKey[]
  available: () => readonly ModelKey[]
  limit: number
  setRecent: (models: ModelKey[]) => void
}) {
  return () => {
    if (!input.persistedReady() || !input.catalogReady()) return

    const recent = input.recent()
    const next = pruneModelKeys(recent, input.available()).slice(0, input.limit)
    if (
      next.length === recent.length &&
      next.every(
        (model, index) => model.providerID === recent[index]?.providerID && model.modelID === recent[index]?.modelID,
      )
    )
      return
    input.setRecent(next)
  }
}

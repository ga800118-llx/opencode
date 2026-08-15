export type ModelKey = { providerID: string; modelID: string }

const key = (model: ModelKey) => `${model.providerID}\0${model.modelID}`

export function parseConfigModel(value: string | undefined) {
  if (!value) return
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return
  return {
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  }
}

export function firstValidModel(candidates: readonly (ModelKey | undefined)[], valid: (model: ModelKey) => boolean) {
  return candidates.find((model): model is ModelKey => !!model && valid(model))
}

export function pruneModelKeys(models: readonly ModelKey[], available: readonly ModelKey[]) {
  const connected = new Set(available.map(key))
  const seen = new Set<string>()
  return models.filter((model) => {
    const value = key(model)
    if (!connected.has(value) || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

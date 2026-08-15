import { createEffect } from "solid-js"
import { Persist } from "@/utils/persist"
import type { ServerScope } from "@/utils/server-scope"
import type { ModelKey } from "./model-selection"

export type RecentModelStore = {
  recent: ModelKey[]
  migrated: boolean
}

const key = (model: ModelKey) => `${model.providerID}\0${model.modelID}`

export function recentModelTarget(scope: ServerScope, directory: string | undefined) {
  if (directory) return Persist.serverWorkspace(scope, directory, "model-recent")
  return Persist.serverGlobal(scope, "model-recent")
}

export function mergeLegacyRecentModels(scoped: readonly ModelKey[], legacy: readonly ModelKey[], limit: number) {
  const seen = new Set<string>()
  return [...scoped, ...legacy]
    .filter((model) => {
      const value = key(model)
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
    .slice(0, limit)
}

export function createRecentModelMigration(input: {
  preferencesReady: () => boolean
  recentReady: () => boolean
  migrated: () => boolean
  scoped: () => readonly ModelKey[]
  legacy: () => readonly ModelKey[]
  limit: number
  set: (models: ModelKey[]) => void
}) {
  createEffect(() => {
    if (!input.preferencesReady() || !input.recentReady() || input.migrated()) return
    input.set(mergeLegacyRecentModels(input.scoped(), input.legacy(), input.limit))
  })
}

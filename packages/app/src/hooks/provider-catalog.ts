import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"

const emptyProviderCatalog: NormalizedProviderListResponse = { all: new Map(), connected: [], default: {} }

type DirectoryCatalog = {
  ready: boolean
  providers: NormalizedProviderListResponse
}

type ProviderCatalogInput =
  | {
      explicit: true
      directory?: string
      catalog?: DirectoryCatalog
      global?: NormalizedProviderListResponse
    }
  | {
      explicit: false
      directory?: string
      catalog?: DirectoryCatalog
      global: NormalizedProviderListResponse
    }

export function selectProviderCatalog(input: ProviderCatalogInput) {
  if (input.directory && input.catalog?.ready)
    return input.global ? includeDesktopModelProfiles(input.catalog.providers, input.global) : input.catalog.providers
  if (input.explicit) return emptyProviderCatalog
  return input.global
}

function includeDesktopModelProfiles(
  directory: NormalizedProviderListResponse,
  global: NormalizedProviderListResponse,
) {
  const connected = new Set(directory.connected)
  const ids = global.connected.filter(
    (id) => id.startsWith("agent-profile-") && global.all.has(id) && !connected.has(id),
  )
  if (ids.length === 0) return directory

  const all = new Map(directory.all)
  const defaults = { ...directory.default }

  ids.forEach((id) => {
    const provider = global.all.get(id)
    if (!provider) return
    all.set(id, provider)
    connected.add(id)
    const model = global.default[id]
    if (model) defaults[id] = model
  })

  return { all, connected: [...connected], default: defaults }
}

export function selectProviderCatalogReady(input: {
  directory?: string
  global: boolean
  catalog?: { ready: boolean }
}) {
  if (!input.directory) return input.global
  return input.catalog?.ready === true
}

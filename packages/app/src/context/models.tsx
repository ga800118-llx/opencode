import { batch, type Accessor, createMemo, getOwner, runWithOwner } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import type { ServerScope } from "@/utils/server-scope"
import { createRecentModelPruner } from "./model-recent-pruning"
import { useServerSDK } from "./server-sdk"
import { createRecentModelMigration, recentModelTarget, type RecentModelStore } from "./model-recent-storage"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"
type User = ModelKey & { visibility: Visibility; favorite?: boolean }
type PreferenceStore = {
  user: User[]
  // Legacy app-global recents seed each scoped recent store once.
  recent: ModelKey[]
  variant?: Record<string, string | undefined>
}

const RECENT_LIMIT = 5

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  gate: false,
  init: (props: { directory?: Accessor<string | undefined> } = {}) => {
    const providers = useProviders(() => props.directory?.())
    const serverSDK = useServerSDK()
    const owner = getOwner()
    if (!owner) throw new Error("Models must be created within an owner")

    const [store, setStore, _, preferencesReady] = persisted(
      Persist.global("model", ["model.v1"]),
      createStore<PreferenceStore>({
        user: [],
        recent: [],
        variant: {},
      }),
    )

    function createRecentStore(scope: ServerScope, directory: string | undefined) {
      const result = runWithOwner(owner, () =>
        persisted(recentModelTarget(scope, directory), createStore<RecentModelStore>({ recent: [], migrated: false })),
      )
      if (!result) throw new Error("Recent models must be created within an owner")
      return result
    }

    const recentStores = new Map<string, ReturnType<typeof createRecentStore>>()
    const recentState = createMemo(() => {
      const scope = serverSDK().scope
      const directory = props.directory?.()
      const key = `${scope}\0${directory ?? "\0global"}`
      const cached = recentStores.get(key)
      if (cached) return cached
      const created = createRecentStore(scope, directory)
      recentStores.set(key, created)
      return created
    })

    createRecentModelMigration({
      preferencesReady,
      recentReady: () => recentState()[3](),
      migrated: () => recentState()[0].migrated,
      scoped: () => recentState()[0].recent,
      legacy: () => store.recent,
      limit: RECENT_LIMIT,
      set(models) {
        const [, setRecent] = recentState()
        batch(() => {
          setRecent("recent", models)
          setRecent("migrated", true)
        })
      },
    })

    const ready = () => {
      const [recent, , , recentReady] = recentState()
      return preferencesReady() && recentReady() && recent.migrated
    }

    const available = createMemo(() =>
      providers.connected().flatMap((p) =>
        Object.values(p.models).map((m) => ({
          ...m,
          provider: p,
        })),
      ),
    )

    const release = createMemo(
      () =>
        new Map(
          available().map((model) => {
            const parsed = DateTime.fromISO(model.release_date)
            return [modelKey({ providerID: model.provider.id, modelID: model.id }), parsed] as const
          }),
        ),
    )

    const latest = createMemo(() =>
      pipe(
        available(),
        filter(
          (x) =>
            Math.abs(
              (release().get(modelKey({ providerID: x.provider.id, modelID: x.id })) ?? DateTime.invalid("invalid"))
                .diffNow()
                .as("months"),
            ) < 6,
        ),
        groupBy((x) => x.provider.id),
        mapValues((models) =>
          pipe(
            models,
            groupBy((x) => x.family),
            values(),
            (groups) =>
              groups.flatMap((g) => {
                const first = firstBy(g, [(x) => x.release_date, "desc"])
                return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
              }),
          ),
        ),
        values(),
        flat(),
      ),
    )

    const latestSet = createMemo(() => new Set(latest().map((x) => modelKey(x))))

    const visibility = createMemo(() => {
      const map = new Map<string, Visibility>()
      for (const item of store.user) map.set(`${item.providerID}:${item.modelID}`, item.visibility)
      return map
    })

    const list = createMemo(() =>
      available().map((m) => ({
        ...m,
        name: m.name.replace("(latest)", "").trim(),
        latest: m.name.includes("(latest)"),
      })),
    )

    const find = (key: ModelKey) => list().find((m) => m.id === key.modelID && m.provider.id === key.providerID)

    function update(model: ModelKey, state: Visibility) {
      const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
      if (index >= 0) {
        setStore("user", index, (current) => ({ ...current, visibility: state }))
        return
      }
      setStore("user", store.user.length, { ...model, visibility: state })
    }

    const visible = (model: ModelKey) => {
      const key = modelKey(model)
      const state = visibility().get(key)
      if (state === "hide") return false
      if (state === "show") return true
      if (latestSet().has(key)) return true
      const date = release().get(key)
      if (!date?.isValid) return true
      return false
    }

    const setVisibility = (model: ModelKey, state: boolean) => {
      update(model, state ? "show" : "hide")
    }

    const push = (model: ModelKey) => {
      const [recent, setRecent] = recentState()
      setRecent(
        "recent",
        uniqueBy([model, ...recent.recent], (x) => `${x.providerID}:${x.modelID}`).slice(0, RECENT_LIMIT),
      )
    }

    const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
    const getVariant = (model: ModelKey) => store.variant?.[variantKey(model)]

    const setVariant = (model: ModelKey, value: string | undefined) => {
      const key = variantKey(model)
      if (!store.variant) {
        setStore("variant", { [key]: value })
        return
      }
      setStore("variant", key, value)
    }

    createRecentModelPruner({
      persistedReady: ready,
      catalogReady: providers.ready,
      recent: () => recentState()[0].recent,
      available: () =>
        available().map((model) => ({
          providerID: model.provider.id,
          modelID: model.id,
        })),
      limit: RECENT_LIMIT,
      setRecent(models) {
        recentState()[1]("recent", models)
      },
    })

    return {
      ready,
      list,
      find,
      visible,
      setVisibility,
      recent: {
        list: () => (ready() ? recentState()[0].recent : []),
        push,
      },
      variant: {
        get: getVariant,
        set: setVariant,
      },
    }
  },
})

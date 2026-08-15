import { batch, createMemo, startTransition } from "solid-js"
import { useModels } from "@/context/models"
import type { ModelKey, ModelSelection } from "@/context/local"
import { firstValidModel, parseConfigModel } from "@/context/model-selection"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "@/context/model-variant"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"

export function createPromptModelSelection(input: { agent: () => { model?: ModelKey; variant?: string } | undefined }) {
  const sdk = useSDK()
  const sync = useSync()
  const models = useModels()
  const prompt = usePrompt()
  const providers = useProviders(() => sdk().directory)
  const valid = (model: ModelKey) => !!models.find(model)

  const fallback = () => {
    const defaults = providers.default()
    return providers
      .connected()
      .flatMap((provider) =>
        [defaults[provider.id], Object.values(provider.models)[0]?.id]
          .filter((modelID): modelID is string => !!modelID)
          .map((modelID) => ({ providerID: provider.id, modelID })),
      )
  }

  const current = () => {
    const key = firstValidModel(
      [
        prompt.model.current(),
        input.agent()?.model,
        parseConfigModel(sync().data.config.model),
        ...models.recent.list(),
        ...fallback(),
      ],
      valid,
    )
    if (!key) return
    return models.find(key)
  }
  const recentModels = createMemo(() =>
    models.recent
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )

  const selection = {
    ready: models.ready,
    current,
    recent: recentModels,
    list: models.list,
    cycle(direction: 1 | -1) {
      const items = recentModels()
      const item = current()
      if (!item) return
      const index = items.findIndex((entry) => entry.provider.id === item.provider.id && entry.id === item.id)
      if (index === -1) return
      const next = items[(index + direction + items.length) % items.length]
      if (next) selection.set({ providerID: next.provider.id, modelID: next.id })
    },
    set(item: ModelKey | undefined, options?: { recent?: boolean }) {
      startTransition(() =>
        batch(() => {
          prompt.model.set(item ? { ...item, variant: prompt.model.current()?.variant } : undefined)
          if (!item) return
          models.setVisibility(item, true)
          if (options?.recent) models.recent.push(item)
        }),
      )
    },
    visible: models.visible,
    setVisibility: models.setVisibility,
    variant: {
      configured() {
        const item = input.agent()
        const model = current()
        if (!item || !model) return
        return getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      },
      selected() {
        return prompt.model.current()?.variant
      },
      current() {
        const resolved = resolveModelVariant({
          variants: this.list(),
          selected: this.selected(),
          configured: this.configured(),
        })
        if (resolved) return resolved
        const model = current()
        if (!model) return
        const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
        if (saved && this.list().includes(saved)) return saved
      },
      list() {
        return Object.keys(current()?.variants ?? {})
      },
      set(value: string | undefined) {
        startTransition(() =>
          batch(() => {
            const model = current()
            if (!model) return
            prompt.model.set({ providerID: model.provider.id, modelID: model.id, variant: value ?? null })
            models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
          }),
        )
      },
      cycle() {
        const variants = this.list()
        if (variants.length === 0) return
        this.set(
          cycleModelVariant({
            variants,
            selected: this.selected(),
            configured: this.configured(),
          }),
        )
      },
    },
  } satisfies ModelSelection

  return selection
}

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { createMemo, Show, type Accessor } from "solid-js"
import type { SettingsTab } from "@/components/settings-v2/dialog-settings-v2"
import { useLanguage } from "@/context/language"
import type { ProductModelReadiness } from "@/product/workflow"

const notices = {
  "setup-required": {
    description: "workflow.modelSetup.description",
    action: "workflow.modelSetup.action",
    settingsTab: "models",
  },
  "desktop-unavailable": {
    description: "workflow.modelSetup.browserDescription",
    action: "workflow.modelSetup.providerAction",
    settingsTab: "models",
  },
} as const satisfies Record<Exclude<ProductModelReadiness, "loading" | "ready">, ModelSetupNoticeViewModel>

export type ModelSetupNoticeViewModel = {
  readonly description:
    | "workflow.modelSetup.description"
    | "workflow.modelSetup.browserDescription"
  readonly action: "workflow.modelSetup.action" | "workflow.modelSetup.providerAction"
  readonly settingsTab: SettingsTab
}

export function modelSetupNoticeViewModel(readiness: ProductModelReadiness) {
  if (readiness === "loading" || readiness === "ready") return
  return notices[readiness]
}

export function providerTipAllowed(readiness: ProductModelReadiness) {
  return !modelSetupNoticeViewModel(readiness)
}

export function modelSetupNoticeSlotPolicy(readiness: ProductModelReadiness) {
  return {
    reserved: true,
    notice: modelSetupNoticeViewModel(readiness),
  } as const
}

export function createModelSetupNoticeController(showSettings: (tab: SettingsTab) => void) {
  return {
    open(readiness: ProductModelReadiness) {
      const notice = modelSetupNoticeViewModel(readiness)
      if (!notice) return
      showSettings(notice.settingsTab)
    },
  }
}

export function ModelSetupNotice(props: {
  readiness: Accessor<ProductModelReadiness>
  class?: string
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const notice = createMemo(() => modelSetupNoticeViewModel(props.readiness()))
  const controller = createModelSetupNoticeController((tab) => {
    void import("@/components/settings-v2").then((module) => {
      void dialog.show(() => <module.DialogSettings defaultValue={tab} />)
    })
  })

  return (
    <Show when={notice()}>
      {(current) => (
        <div
          data-component="model-setup-notice"
          role="status"
          aria-live="polite"
          class={`${props.class ?? ""} flex min-w-0 flex-wrap items-center gap-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-2`}
        >
          <div class="flex min-w-0 flex-1 items-start gap-2">
            <IconV2 name="models" size="small" class="mt-0.5 shrink-0 text-v2-icon-icon-muted" />
            <p class="min-w-0 flex-1 whitespace-normal break-words text-[13px] leading-5 text-v2-text-text-muted">
              {language.t(current().description)}
            </p>
          </div>
          <ButtonV2
            data-action="configure-models"
            size="small"
            variant="contrast"
            class="shrink-0"
            onClick={() => controller.open(props.readiness())}
          >
            {language.t(current().action)}
          </ButtonV2>
        </div>
      )}
    </Show>
  )
}

export function ModelSetupNoticeSlot(props: {
  readiness: Accessor<ProductModelReadiness>
  class?: string
}) {
  return (
    <div
      data-component="model-setup-notice-slot"
      data-readiness={props.readiness()}
      class={`${props.class ?? ""} relative h-[104px] min-w-0 shrink-0 sm:h-[68px] lg:h-[44px]`}
    >
      <ModelSetupNotice readiness={props.readiness} class="absolute inset-0 h-full" />
    </div>
  )
}

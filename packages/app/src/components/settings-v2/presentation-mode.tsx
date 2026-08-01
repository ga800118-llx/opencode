import type { Component } from "solid-js"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { useLanguage } from "@/context/language"
import type { ProductPresentationMode } from "@/product/workflow/presentation"
import { SettingsRowV2 } from "./parts/row"

const modes: ProductPresentationMode[] = ["simple", "advanced"]

export function createPresentationModeSetting(input: {
  mode: () => ProductPresentationMode
  label: (mode: ProductPresentationMode) => string
  onChange: (mode: ProductPresentationMode) => void
}) {
  return {
    options: modes,
    current: () => modes.find((mode) => mode === input.mode()) ?? modes[0],
    label: input.label,
    select(option: ProductPresentationMode | null | undefined) {
      if (!option) return
      input.onChange(option)
    },
  }
}

export const PresentationModeSetting: Component<{
  mode: ProductPresentationMode
  onChange: (mode: ProductPresentationMode) => void
}> = (props) => {
  const language = useLanguage()
  const title = () => language.t("settings.general.row.presentationMode.title")
  const setting = createPresentationModeSetting({
    mode: () => props.mode,
    label: (mode) => language.t(`settings.general.row.presentationMode.option.${mode}`),
    onChange: props.onChange,
  })
  return (
    <SettingsRowV2 title={title()} description={language.t("settings.general.row.presentationMode.description")}>
      <SelectV2
        appearance="inline"
        data-action="settings-presentation-mode"
        aria-label={title()}
        options={setting.options}
        current={setting.current()}
        placement="bottom-end"
        gutter={6}
        label={setting.label}
        onSelect={setting.select}
      />
    </SettingsRowV2>
  )
}

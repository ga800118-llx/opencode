import { describe, expect, test } from "bun:test"
import { dict } from "@/i18n/en"
import type { ProductPresentationMode } from "@/product/workflow/presentation"
import { createPresentationModeSetting } from "./presentation-mode"

describe("PresentationModeSetting", () => {
  test("provides both localized modes, selected state, and callback values", () => {
    const state: { mode: ProductPresentationMode } = { mode: "simple" }
    const selections: ProductPresentationMode[] = []
    const setting = createPresentationModeSetting({
      mode: () => state.mode,
      label: (mode) => dict[`settings.general.row.presentationMode.option.${mode}`],
      onChange(value) {
        selections.push(value)
        state.mode = value
      },
    })

    expect(setting.options).toEqual(["simple", "advanced"])
    expect(setting.options.map(setting.label)).toEqual(["Simple", "Advanced"])
    expect(setting.current()).toBe("simple")

    setting.select(setting.options[1])
    expect(selections).toEqual(["advanced"])
    expect(setting.current()).toBe("advanced")

    setting.select(setting.options[0])
    expect(selections).toEqual(["advanced", "simple"])
    expect(setting.current()).toBe("simple")
  })
})

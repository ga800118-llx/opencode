import { describe, expect, test } from "bun:test"
import { modelReadiness } from "@/product/workflow"
import {
  createModelSetupNoticeController,
  modelSetupNoticeViewModel,
  providerTipAllowed,
} from "./model-setup-notice"

describe("modelSetupNoticeViewModel", () => {
  test("is absent while model readiness is loading or ready", () => {
    expect(modelSetupNoticeViewModel("loading")).toBeUndefined()
    expect(modelSetupNoticeViewModel("ready")).toBeUndefined()
    expect(
      modelSetupNoticeViewModel(
        modelReadiness({
          providersLoading: false,
          hasUsableSelectedModel: true,
          availableModelCount: 0,
          desktopModelCenterAvailable: true,
        }),
      ),
    ).toBeUndefined()
  })

  test("opens the Models settings tab for desktop setup", () => {
    expect(modelSetupNoticeViewModel("setup-required")).toEqual({
      description: "workflow.modelSetup.description",
      action: "workflow.modelSetup.action",
      settingsTab: "models",
    })

    const opened: string[] = []
    createModelSetupNoticeController((tab) => opened.push(tab)).open("setup-required")
    expect(opened).toEqual(["models"])
  })

  test("uses accurate provider settings copy when desktop setup is unavailable", () => {
    expect(modelSetupNoticeViewModel("desktop-unavailable")).toEqual({
      description: "workflow.modelSetup.browserDescription",
      action: "workflow.modelSetup.providerAction",
      settingsTab: "providers",
    })
  })

  test("suppresses the provider tip whenever setup guidance is active", () => {
    expect(providerTipAllowed("setup-required")).toBe(false)
    expect(providerTipAllowed("desktop-unavailable")).toBe(false)
    expect(providerTipAllowed("loading")).toBe(false)
    expect(providerTipAllowed("ready")).toBe(true)
  })
})

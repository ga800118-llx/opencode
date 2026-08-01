import { describe, expect, test } from "bun:test"
import { modelReadiness } from "@/product/workflow"
import {
  createModelSetupNoticeController,
  modelSetupNoticeSlotPolicy,
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

  test("keeps browser fallback guidance on the Models settings page", () => {
    expect(modelSetupNoticeViewModel("desktop-unavailable")).toEqual({
      description: "workflow.modelSetup.browserDescription",
      action: "workflow.modelSetup.providerAction",
      settingsTab: "models",
    })
  })

  test("suppresses the provider tip exactly when setup guidance is present", () => {
    expect(providerTipAllowed("setup-required")).toBe(false)
    expect(providerTipAllowed("desktop-unavailable")).toBe(false)
    expect(providerTipAllowed("loading")).toBe(true)
    expect(providerTipAllowed("ready")).toBe(true)
  })

  test("reserves the notice slot in every readiness state without hidden content", () => {
    expect(modelSetupNoticeSlotPolicy("loading")).toEqual({ reserved: true, notice: undefined })
    expect(modelSetupNoticeSlotPolicy("ready")).toEqual({ reserved: true, notice: undefined })
    expect(modelSetupNoticeSlotPolicy("setup-required")).toEqual({
      reserved: true,
      notice: modelSetupNoticeViewModel("setup-required"),
    })
    expect(modelSetupNoticeSlotPolicy("desktop-unavailable")).toEqual({
      reserved: true,
      notice: modelSetupNoticeViewModel("desktop-unavailable"),
    })
  })
})

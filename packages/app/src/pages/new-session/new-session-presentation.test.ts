import { describe, expect, test } from "bun:test"
import { createNewSessionPresentation } from "./new-session-presentation"

describe("createNewSessionPresentation", () => {
  test("keeps the prompt workflow visible and makes technical details secondary in Simple", () => {
    const presentation = createNewSessionPresentation("simple")

    expect(presentation.mode).toBe("simple")
    expect(presentation.controls.composer).toEqual({ visible: true, priority: "primary" })
    expect(presentation.controls.project).toEqual({ visible: true, priority: "primary" })
    expect(presentation.controls.model).toEqual({ visible: true, priority: "primary" })
    expect(presentation.controls.attachments).toEqual({ visible: true, priority: "primary" })
    expect(presentation.controls.submit).toEqual({ visible: true, priority: "primary" })
    expect(presentation.controls.worktree).toEqual({ visible: true, priority: "secondary" })
    expect(presentation.controls.git).toEqual({ visible: true, priority: "secondary" })
    expect(presentation.controls.providerPromotion).toEqual({ visible: true, priority: "secondary" })
  })

  test("exposes the complete existing control set in Advanced", () => {
    const presentation = createNewSessionPresentation("advanced")

    expect(presentation.mode).toBe("advanced")
    expect(Object.keys(presentation.controls)).toEqual([
      "composer",
      "project",
      "worktree",
      "git",
      "agent",
      "model",
      "commands",
      "attachments",
      "options",
      "submit",
      "modelReadiness",
      "providerPromotion",
    ])
    expect(Object.values(presentation.controls).every((control) => control.visible)).toBe(true)
    expect(Object.values(presentation.controls).every((control) => control.priority === "primary")).toBe(true)
  })
})

import { describe, expect, test } from "bun:test"
import { sessionPanelLayout } from "./session-panel-layout"
import { createTaskPresentation } from "./task-presentation"

describe("sessionPanelLayout", () => {
  test("keeps one V2 owner while changing panel geometry", () => {
    expect(sessionPanelLayout({ review: false, terminal: false, files: false })).toEqual({
      visible: false,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: false, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: false,
    })
    expect(sessionPanelLayout({ review: true, terminal: true, files: false })).toEqual({
      visible: true,
      stacked: true,
    })
  })

  test("preserves open panel geometry across task presentation modes", () => {
    for (const mode of ["simple", "advanced"] as const) {
      const presentation = createTaskPresentation({
        mode,
        shellToolPartsExpanded: true,
        editToolPartsExpanded: true,
        visibility: { review: true, terminal: true, files: true, agents: true, status: true },
      })

      expect(
        sessionPanelLayout({
          review: presentation.visibility.review,
          terminal: presentation.visibility.terminal,
          files: presentation.visibility.files,
        }),
      ).toEqual({ visible: true, stacked: true })
    }
  })
})

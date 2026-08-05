import { describe, expect, test } from "bun:test"
import { createTaskPresentation } from "./task-presentation"

const visibility = {
  review: true,
  files: true,
  terminal: true,
  agents: false,
  status: false,
}

describe("createTaskPresentation", () => {
  test("uses collapsed tool details and compact context actions in Simple", () => {
    const presentation = createTaskPresentation({
      mode: "simple",
      shellToolPartsExpanded: true,
      editToolPartsExpanded: true,
      visibility,
    })

    expect(presentation.toolDetails).toEqual({ shell: false, edit: false })
    expect(presentation.contextActionDensity).toBe("compact")
    expect(presentation.visibility).toEqual(visibility)
  })

  test("honors existing tool preferences and visibility state in Advanced", () => {
    const presentation = createTaskPresentation({
      mode: "advanced",
      shellToolPartsExpanded: true,
      editToolPartsExpanded: false,
      visibility,
    })

    expect(presentation.toolDetails).toEqual({ shell: true, edit: false })
    expect(presentation.contextActionDensity).toBe("full")
    expect(presentation.visibility).toEqual(visibility)
  })

  test("retains every task capability in both modes", () => {
    for (const mode of ["simple", "advanced"] as const) {
      const presentation = createTaskPresentation({
        mode,
        shellToolPartsExpanded: false,
        editToolPartsExpanded: false,
        visibility,
      })

      expect(presentation.capabilities).toEqual({
        review: true,
        terminal: true,
        files: true,
        permissions: true,
        questions: true,
        attachments: true,
        childSessions: true,
        commands: true,
        model: true,
      })
      expect(Object.isFrozen(presentation.capabilities)).toBe(true)
    }
  })
})

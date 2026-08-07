import { expect, test } from "bun:test"
import { createContextMenuLabels } from "./context-menu-labels"
import { createContextMenuOptions } from "./context-menu-options"

test("preserves mutable labels and enables the intended context-menu actions", () => {
  const labels = createContextMenuLabels("zh")
  const options = createContextMenuOptions(labels)

  expect(options.labels).toBe(labels)
  expect(options.showSelectAll).toBe(true)
  expect(options.showSaveImageAs).toBe(true)
  expect(options.showLookUpSelection).toBe(false)
  expect(options.showSearchWithGoogle).toBe(false)
})

import { describe, expect, test } from "bun:test"
import { modelGroupExpanded } from "./model-list-presentation"

describe("modelGroupExpanded", () => {
  test("expands small catalogs by default", () => {
    expect(modelGroupExpanded({ resultCount: 11, searching: false })).toBe(true)
  })

  test("collapses large catalogs until a provider is opened", () => {
    expect(modelGroupExpanded({ resultCount: 6_631, searching: false })).toBe(false)
    expect(modelGroupExpanded({ resultCount: 6_631, searching: false, collapsed: false })).toBe(true)
  })

  test("only auto-expands searches with a bounded result set", () => {
    expect(modelGroupExpanded({ resultCount: 20, searching: true, collapsed: true })).toBe(true)
    expect(modelGroupExpanded({ resultCount: 2_000, searching: true })).toBe(false)
  })
})

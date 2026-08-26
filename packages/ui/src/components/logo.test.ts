import { describe, expect, test } from "bun:test"
import { GUAI_MARK_PATH, GUAI_MARK_VIEWBOX, GUAI_WORDMARK } from "./logo-geometry"

describe("Guai logo", () => {
  test("defines the approved geometric mark and brand wordmark", () => {
    expect(GUAI_MARK_VIEWBOX).toBe("0 0 100 108")
    expect(GUAI_MARK_PATH).toBe("M50 4L74 18L31 43V70L50 81L67 71L50 61L72 49H94V78L50 104L6 78V30L50 4Z")
    expect(GUAI_WORDMARK).toBe("GUAI")
  })

  test("uses the shared geometry in every logo component", async () => {
    const source = await Bun.file(new URL("./logo.tsx", import.meta.url)).text()

    expect(source.match(/d=\{GUAI_MARK_PATH\}/g)).toHaveLength(3)
    expect(source).toContain("viewBox={GUAI_MARK_VIEWBOX}")
    expect(source).toContain("{GUAI_WORDMARK}")
    expect(source).not.toContain("logo-mark-g-top")
    expect(source).not.toContain("Guai Code")
  })
})

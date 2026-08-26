import { describe, expect, test } from "bun:test"
import { GUAI_MARK_PATH } from "@opencode-ai/ui/logo-geometry"
import { encodeIco, guaiAppIconSvg } from "./generate-brand-icons"

describe("Guai brand icon generator", () => {
  test("builds the approved rounded-square application icon", () => {
    const svg = guaiAppIconSvg()

    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('fill="#0D0D0D"')
    expect(svg).toContain('fill="#FFFFFF"')
    expect(svg).toContain('rx="208"')
    expect(svg).toContain(`d="${GUAI_MARK_PATH}"`)
  })

  test("encodes PNG frames into a valid ICO directory", () => {
    const first = new Uint8Array([1, 2, 3])
    const second = new Uint8Array([4, 5, 6, 7])
    const ico = encodeIco([
      { size: 16, data: first },
      { size: 256, data: second },
    ])
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength)

    expect(view.getUint16(0, true)).toBe(0)
    expect(view.getUint16(2, true)).toBe(1)
    expect(view.getUint16(4, true)).toBe(2)
    expect(view.getUint8(6)).toBe(16)
    expect(view.getUint8(22)).toBe(0)
    expect(view.getUint32(14, true)).toBe(first.length)
    expect(view.getUint32(18, true)).toBe(38)
    expect(view.getUint32(30, true)).toBe(second.length)
    expect(view.getUint32(34, true)).toBe(38 + first.length)
    expect([...ico.slice(38, 38 + first.length)]).toEqual([...first])
    expect([...ico.slice(38 + first.length)]).toEqual([...second])
  })
})

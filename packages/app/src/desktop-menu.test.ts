import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU, desktopMenuLabel, normalizeDesktopMenuLocale } from "./desktop-menu"

describe("desktop menu", () => {
  test("resolves every desktop label in Simplified Chinese", () => {
    const labels = DESKTOP_MENU.flatMap((menu) => [
      menu.label,
      ...(menu.items ?? []).flatMap((item) => (item.type === "item" ? [item.label] : [])),
    ])

    expect(labels.every((label) => desktopMenuLabel(label, "zh", "Agent Desktop Dev").length > 0)).toBe(true)
    expect(desktopMenuLabel("menu.file", "zh", "Agent Desktop Dev")).toBe("文件")
    expect(desktopMenuLabel("app.quit", "zh", "Agent Desktop Dev")).toBe("退出 Agent Desktop Dev")
  })

  test("normalizes native shell locales without accepting arbitrary values", () => {
    expect(normalizeDesktopMenuLocale("zh")).toBe("zh")
    expect(normalizeDesktopMenuLocale("zht")).toBe("zht")
    expect(normalizeDesktopMenuLocale("en")).toBe("en")
    expect(normalizeDesktopMenuLocale("ja")).toBe("en")
    expect(normalizeDesktopMenuLocale("<script>")).toBe("en")
  })

  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.label === "app.exportLogs",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })
})

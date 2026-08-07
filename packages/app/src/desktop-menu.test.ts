import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU, desktopMenuLabel, normalizeDesktopMenuLocale } from "./desktop-menu"

describe("desktop menu", () => {
  test("resolves every desktop label in every supported locale", () => {
    for (const locale of ["en", "zh", "zht"] as const) {
      expect(
        DESKTOP_MENU.flatMap((menu) => [
          menu.label,
          ...(menu.items ?? []).flatMap((item) => (item.type === "item" ? [item.label] : [])),
        ]).every((label) => {
          const resolved = desktopMenuLabel(label, locale, "Agent Desktop Dev")
          return resolved.length > 0 && !resolved.includes("{appName}")
        }),
      ).toBe(true)
    }
    expect(desktopMenuLabel("menu.file", "zh", "Agent Desktop Dev")).toBe("文件")
    expect(desktopMenuLabel("app.quit", "zh", "Agent Desktop Dev")).toBe("退出 Agent Desktop Dev")
  })

  test("interpolates app names without interpreting replacement tokens", () => {
    const appName = "$& $$ $` $'"

    expect([
      desktopMenuLabel("app.about", "en", appName),
      desktopMenuLabel("app.about", "zh", appName),
      desktopMenuLabel("app.about", "zht", appName),
    ]).toEqual([`About ${appName}`, `关于 ${appName}`, `關於 ${appName}`])
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

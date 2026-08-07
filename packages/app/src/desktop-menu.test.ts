import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU, desktopMenuLabel, normalizeDesktopMenuLocale } from "./desktop-menu"

describe("desktop menu", () => {
  test("resolves every desktop label in every supported locale", () => {
    (["en", "zh", "zht"] as const).forEach((locale) => {
      expect(
        DESKTOP_MENU.flatMap((menu) => [
          menu.label,
          ...(menu.items ?? []).flatMap((item) => (item.type === "item" ? [item.label] : [])),
        ]).every((label) => {
          const resolved = desktopMenuLabel(label, locale, "Agent Desktop Dev")
          return resolved.length > 0 && !resolved.includes("{appName}")
        }),
      ).toBe(true)
    })
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

  test.each([
    ["zh", "zh"],
    ["zh-CN", "zh"],
    ["zh-SG", "zh"],
    ["zh-Hans", "zh"],
    ["zh-Hans-CN", "zh"],
    ["ZH_cn", "zh"],
    ["zh_HANS_sg", "zh"],
    ["zht", "zht"],
    ["ZHT", "zht"],
    ["zh-TW", "zht"],
    ["zh-HK", "zht"],
    ["zh-MO", "zht"],
    ["zh-Hant", "zht"],
    ["zh-Hant-TW", "zht"],
    ["ZH_tw", "zht"],
    ["zh_HANT_hk", "zht"],
    ["zh-Hant-CN", "zht"],
    ["en", "en"],
    ["ja", "en"],
    ["zh-US", "en"],
    ["<script>", "en"],
  ] as const)("normalizes native shell locale %s to %s", (locale, expected) => {
    expect(normalizeDesktopMenuLocale(locale)).toBe(expected)
  })

  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.label === "app.exportLogs",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })
})

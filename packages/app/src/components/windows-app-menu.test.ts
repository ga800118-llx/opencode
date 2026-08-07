import { expect, test } from "bun:test"
import { resolveWindowsDesktopMenu } from "./windows-app-menu"

test("resolves Windows menu labels before rendering", () => {
  const menus = resolveWindowsDesktopMenu("zh")

  expect(menus.map((menu) => menu.label)).toEqual(["文件", "编辑", "显示", "前往", "窗口", "帮助"])
  expect(
    menus
      .flatMap((menu) => [
        menu.label,
        ...(menu.items ?? []).flatMap((item) => (item.type === "item" ? [item.label] : [])),
      ])
      .every((label) => !/^(menu|app|file|edit|view|go|window|help)\./.test(label)),
  ).toBe(true)
})

import { expect, test } from "bun:test"
import { resolveWindowsDesktopMenu } from "./windows-app-menu"

test("resolves Windows menu labels before rendering", () => {
  const menus = resolveWindowsDesktopMenu("zh", "OpenCode")

  expect(menus.map((menu) => menu.label)).toEqual(["文件", "编辑", "显示", "前往", "窗口", "帮助"])
  expect(
    menus
      .flatMap((menu) => [
        menu.label,
        ...(menu.items ?? []).flatMap((item) => (item.type === "item" ? [item.label] : [])),
      ])
      .every((label) => !/^(menu|app|file|edit|view|go|window|help)\./.test(label)),
  ).toBe(true)
  const window = menus.find((menu) => menu.label === "窗口")
  expect(window?.items?.map((item) => (item.type === "separator" ? "separator" : item.label))).toEqual([
    "最小化",
    "最大化",
    "separator",
    "关闭窗口",
  ])
  expect(window?.items?.filter((item) => item.type === "item").every((item) => !item.role)).toBe(true)
  expect(window?.items?.some((item) => item.type === "item" && ["缩放", "前置全部窗口"].includes(item.label))).toBe(
    false,
  )
})

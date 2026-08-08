import { describe, expect, test } from "bun:test"
import { createDesktopMenuTemplate } from "./menu-template"

describe("desktop menu template", () => {
  test("builds a fully labeled Simplified Chinese macOS template", () => {
    const template = createDesktopMenuTemplate({
      locale: "zh",
      appName: "Agent Desktop Dev",
      updaterEnabled: true,
      trigger: () => undefined,
      action: () => undefined,
      openExternal: () => undefined,
    })

    expect(template.map((item) => item.label)).toEqual([
      "Agent Desktop Dev",
      "文件",
      "编辑",
      "显示",
      "前往",
      "窗口",
      "帮助",
    ])
    expect(
      template
        .flatMap((menu) => [
          menu.label,
          ...(menu.submenu ?? []).flatMap((item) => (item.label ? [item.label] : [])),
        ])
        .every((label) => label.length > 0 && !/^(menu|app|file|edit|view|go|window|help)\./.test(label)),
    ).toBe(true)
    const edit = template.find((item) => item.label === "编辑")
    expect(edit?.submenu?.find((item) => item.role === "copy")).toMatchObject({ label: "复制", role: "copy" })
    expect(edit?.submenu?.find((item) => item.role === "paste")).toMatchObject({ label: "粘贴", role: "paste" })
    expect(edit?.submenu?.find((item) => item.role === "selectAll")).toMatchObject({
      label: "全选",
      role: "selectAll",
    })
    const window = template.find((item) => item.label === "窗口")
    expect(
      window?.submenu?.map((item) =>
        item.type === "separator" ? { type: item.type } : { label: item.label, role: item.role },
      ),
    ).toEqual([
      { label: "最小化", role: "minimize" },
      { label: "缩放", role: "zoom" },
      { type: "separator" },
      { label: "前置全部窗口", role: "front" },
    ])
  })

  test("preserves callbacks, accelerators, and updater state", () => {
    const commands: string[] = []
    const actions: string[] = []
    const hrefs: string[] = []
    const template = createDesktopMenuTemplate({
      locale: "zh",
      appName: "Agent Desktop Dev",
      updaterEnabled: true,
      trigger: (id) => commands.push(id),
      action: (action) => actions.push(action),
      openExternal: (href) => hrefs.push(href),
    })
    const app = template.find((item) => item.label === "Agent Desktop Dev")
    const settings = app?.submenu?.find((item) => item.label === "设置")
    const reload = app?.submenu?.find((item) => item.label === "重新加载界面")
    const updates = app?.submenu?.find((item) => item.label === "检查更新...")
    const help = template.find((item) => item.label === "帮助")
    const documentation = help?.submenu?.find((item) => item.label === "Guai Code 文档")

    settings?.click?.()
    reload?.click?.()
    documentation?.click?.()

    expect(commands).toEqual(["settings.open"])
    expect(actions).toEqual(["view.reload"])
    expect(hrefs).toEqual(["https://opencode.ai/docs"])
    expect(settings?.accelerator).toBe("Cmd+,")
    expect(updates?.enabled).toBe(true)
  })
})

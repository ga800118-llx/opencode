# Desktop Menu Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the macOS menu bar, Electron right-click menu, and prompt plus menu fully Chinese whenever the application locale is Simplified Chinese, with live locale synchronization and no behavior regressions.

**Architecture:** The shared desktop menu uses stable label identifiers resolved by a typed English/Simplified Chinese/Traditional Chinese copy table. A main-process native UI controller owns application-menu rebuilding and context-menu listener replacement, while a validated preload bridge synchronizes the renderer locale. `PromptInputV2` receives typed localized copy from the app and keeps English defaults for standalone consumers.

**Tech Stack:** TypeScript, SolidJS, Electron 42, `electron-context-menu`, Bun tests/typecheck, Vite, Playwright, agent-browser, macOS packaged application QA.

---

## File Map

- Create `packages/app/src/desktop-menu-copy.ts`: desktop menu locale normalization, label identifiers, and English/Chinese copy tables.
- Modify `packages/app/src/desktop-menu.ts`: replace display literals with stable label identifiers.
- Modify `packages/app/src/desktop-menu.test.ts`: verify copy completeness and preserved command metadata.
- Create `packages/desktop/src/main/menu-template.ts`: pure Electron menu-template construction.
- Create `packages/desktop/src/main/menu-template.test.ts`: Chinese template, role, command, and accelerator coverage.
- Modify `packages/desktop/src/main/menu.ts`: install the pure resolved template.
- Create `packages/desktop/src/main/context-menu-labels.ts`: complete locale-aware `electron-context-menu` labels.
- Create `packages/desktop/src/main/context-menu-labels.test.ts`: editing, link, image, video, inspect, and services copy coverage.
- Create `packages/desktop/src/main/native-ui-controller.ts`: locale lifecycle for application and context menus.
- Create `packages/desktop/src/main/native-ui-controller.test.ts`: normalization, duplicate suppression, rebuild, and cleanup coverage.
- Modify `packages/desktop/src/main/index.ts`: wire the native UI controller and remove the unlocalized context-menu registration.
- Modify `packages/desktop/src/main/ipc.ts`: accept validated application-locale updates.
- Create `packages/desktop/src/preload/application-locale.ts`: fixed-channel locale setter factory.
- Create `packages/desktop/src/preload/application-locale.test.ts`: preload locale-channel contract.
- Modify `packages/desktop/src/preload/types.ts`: type the locale bridge.
- Modify `packages/desktop/src/preload/index.ts`: expose the locale bridge.
- Modify `packages/desktop/src/renderer/index.tsx`: implement the desktop platform locale callback.
- Modify `packages/app/src/context/platform.tsx`: add the optional platform locale callback.
- Modify `packages/app/src/app.tsx`: synchronize `useLanguage().locale()` to desktop platforms.
- Modify `packages/session-ui/src/v2/components/prompt-input/index.tsx`: accept and render typed prompt copy.
- Create `packages/app/src/components/prompt-input-v2-copy.ts`: map app translation keys to shared prompt copy.
- Create `packages/app/src/components/prompt-input-v2-copy.test.ts`: exact Simplified Chinese prompt copy coverage.
- Modify `packages/app/src/components/prompt-input-v2.tsx`: pass localized prompt copy.
- Modify `packages/app/src/i18n/zh.ts`: translate the normal prompt label as `提示词`.
- Modify `packages/app/src/i18n/zht.ts`: translate the normal prompt label as `提示詞`.
- Create `packages/app/e2e/fixtures/localized-prompt-menu/index.html`: browser fixture shell.
- Create `packages/app/e2e/fixtures/localized-prompt-menu/main.tsx`: Chinese plus-menu fixture.
- Create `packages/app/e2e/regression/localized-prompt-menu.spec.ts`: rendered Chinese menu regression test.

### Task 1: Stable Desktop Menu Copy

**Files:**
- Create: `packages/app/src/desktop-menu-copy.ts`
- Modify: `packages/app/src/desktop-menu.ts`
- Modify: `packages/app/src/desktop-menu.test.ts`

- [ ] **Step 1: Write failing copy-completeness tests**

Extend `desktop-menu.test.ts` with tests shaped as follows:

```ts
import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"
import { desktopMenuLabel, normalizeDesktopMenuLocale } from "./desktop-menu-copy"

test("resolves every desktop label in Simplified Chinese", () => {
  const labels = DESKTOP_MENU.flatMap((menu) => [menu.label, ...(menu.items ?? []).flatMap((item) =>
    item.type === "item" ? [item.label] : [],
  )])
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
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/desktop-menu.test.ts
```

Expected: FAIL because `desktop-menu-copy.ts` and label identifiers do not exist.

- [ ] **Step 3: Add the typed copy resolver**

Create `desktop-menu-copy.ts` with this public shape:

```ts
export type DesktopMenuLocale = "en" | "zh" | "zht"

export type DesktopMenuLabel =
  | "menu.app"
  | "menu.file"
  | "menu.edit"
  | "menu.view"
  | "menu.go"
  | "menu.window"
  | "menu.help"
  | "app.about"
  | "app.checkForUpdates"
  | "app.settings"
  | "app.reloadWebview"
  | "app.restart"
  | "app.exportLogs"
  | "app.hide"
  | "app.hideOthers"
  | "app.showAll"
  | "app.quit"
  | "file.newTask"
  | "file.openProject"
  | "file.newWindow"
  | "file.closeWindow"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.toggleSidebar"
  | "view.toggleTerminal"
  | "view.toggleFileTree"
  | "view.reload"
  | "view.toggleDeveloperTools"
  | "view.actualSize"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleFullScreen"
  | "go.back"
  | "go.forward"
  | "go.previousTask"
  | "go.nextTask"
  | "go.previousProject"
  | "go.nextProject"
  | "window.minimize"
  | "window.maximize"
  | "help.documentation"
  | "help.supportForum"
  | "help.shareFeedback"
  | "help.reportBug"

export function normalizeDesktopMenuLocale(value: string): DesktopMenuLocale {
  if (value === "zh" || value === "zht") return value
  return "en"
}

export function desktopMenuLabel(label: DesktopMenuLabel, locale: string, appName: string) {
  return copy[normalizeDesktopMenuLocale(locale)][label].replaceAll("{appName}", appName)
}
```

Populate `copy` as `satisfies Record<DesktopMenuLocale, Record<DesktopMenuLabel, string>>`. Use these Simplified Chinese values:

```ts
{
  "menu.app": "{appName}",
  "menu.file": "文件",
  "menu.edit": "编辑",
  "menu.view": "显示",
  "menu.go": "前往",
  "menu.window": "窗口",
  "menu.help": "帮助",
  "app.about": "关于 {appName}",
  "app.checkForUpdates": "检查更新...",
  "app.settings": "设置",
  "app.reloadWebview": "重新加载界面",
  "app.restart": "重新启动",
  "app.exportLogs": "导出日志...",
  "app.hide": "隐藏 {appName}",
  "app.hideOthers": "隐藏其他",
  "app.showAll": "全部显示",
  "app.quit": "退出 {appName}",
  "file.newTask": "新建任务",
  "file.openProject": "打开项目...",
  "file.newWindow": "新建窗口",
  "file.closeWindow": "关闭窗口",
  "edit.undo": "撤销",
  "edit.redo": "重做",
  "edit.cut": "剪切",
  "edit.copy": "复制",
  "edit.paste": "粘贴",
  "edit.delete": "删除",
  "edit.selectAll": "全选",
  "view.toggleSidebar": "切换侧边栏",
  "view.toggleTerminal": "切换终端",
  "view.toggleFileTree": "切换文件树",
  "view.reload": "重新加载",
  "view.toggleDeveloperTools": "切换开发者工具",
  "view.actualSize": "实际大小",
  "view.zoomIn": "放大",
  "view.zoomOut": "缩小",
  "view.toggleFullScreen": "切换全屏",
  "go.back": "返回",
  "go.forward": "前进",
  "go.previousTask": "上一个任务",
  "go.nextTask": "下一个任务",
  "go.previousProject": "上一个项目",
  "go.nextProject": "下一个项目",
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "help.documentation": "OpenCode 文档",
  "help.supportForum": "支持论坛",
  "help.shareFeedback": "分享反馈",
  "help.reportBug": "报告问题",
}
```

Use this complete Traditional Chinese record:

```ts
{
  "menu.app": "{appName}",
  "menu.file": "檔案",
  "menu.edit": "編輯",
  "menu.view": "顯示",
  "menu.go": "前往",
  "menu.window": "視窗",
  "menu.help": "說明",
  "app.about": "關於 {appName}",
  "app.checkForUpdates": "檢查更新...",
  "app.settings": "設定",
  "app.reloadWebview": "重新載入介面",
  "app.restart": "重新啟動",
  "app.exportLogs": "匯出日誌...",
  "app.hide": "隱藏 {appName}",
  "app.hideOthers": "隱藏其他",
  "app.showAll": "全部顯示",
  "app.quit": "結束 {appName}",
  "file.newTask": "新增任務",
  "file.openProject": "開啟專案...",
  "file.newWindow": "新增視窗",
  "file.closeWindow": "關閉視窗",
  "edit.undo": "復原",
  "edit.redo": "重做",
  "edit.cut": "剪下",
  "edit.copy": "複製",
  "edit.paste": "貼上",
  "edit.delete": "刪除",
  "edit.selectAll": "全選",
  "view.toggleSidebar": "切換側邊欄",
  "view.toggleTerminal": "切換終端機",
  "view.toggleFileTree": "切換檔案樹",
  "view.reload": "重新載入",
  "view.toggleDeveloperTools": "切換開發者工具",
  "view.actualSize": "實際大小",
  "view.zoomIn": "放大",
  "view.zoomOut": "縮小",
  "view.toggleFullScreen": "切換全螢幕",
  "go.back": "返回",
  "go.forward": "前進",
  "go.previousTask": "上一個任務",
  "go.nextTask": "下一個任務",
  "go.previousProject": "上一個專案",
  "go.nextProject": "下一個專案",
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "help.documentation": "OpenCode 文件",
  "help.supportForum": "支援論壇",
  "help.shareFeedback": "分享意見",
  "help.reportBug": "回報問題",
}
```

The English table uses the current labels except `New Session`, `Previous Session`, and `Next Session`, which become `New Task`, `Previous Task`, and `Next Task` to match current product terminology. Re-export `DesktopMenuLabel`, `DesktopMenuLocale`, `desktopMenuLabel`, and `normalizeDesktopMenuLocale` from `desktop-menu.ts` so the existing `@opencode-ai/app/desktop-menu` package export remains the only public runtime path.

- [ ] **Step 4: Replace menu literals with label identifiers**

In `desktop-menu.ts`, import `DesktopMenuLabel`, change both menu and item label types to that union, assign every role-only item an explicit label identifier, and replace every English label with the matching identifier. Preserve action IDs, command IDs, hrefs, roles, platform filters, and accelerators exactly.

Example:

```ts
{
  id: "edit",
  label: "menu.edit",
  items: [
    { type: "item", label: "edit.undo", action: "edit.undo", role: "undo", accelerator: { windows: "Ctrl+Z" } },
    { type: "item", label: "edit.redo", action: "edit.redo", role: "redo", accelerator: { windows: "Ctrl+Y" } },
    { type: "separator" },
    { type: "item", label: "edit.cut", action: "edit.cut", role: "cut", accelerator: { windows: "Ctrl+X" } },
    { type: "item", label: "edit.copy", action: "edit.copy", role: "copy", accelerator: { windows: "Ctrl+C" } },
    { type: "item", label: "edit.paste", action: "edit.paste", role: "paste", accelerator: { windows: "Ctrl+V" } },
    { type: "item", label: "edit.delete", action: "edit.delete" },
    { type: "item", label: "edit.selectAll", action: "edit.selectAll", role: "selectAll", accelerator: { windows: "Ctrl+A" } },
  ],
}
```

- [ ] **Step 5: Run app tests and typecheck**

```bash
bun test --conditions=solid --preload ./happydom.ts src/desktop-menu.test.ts
bun typecheck
```

Expected: all desktop-menu tests PASS and app typecheck exits 0.

- [ ] **Step 6: Commit stable menu copy**

```bash
git add packages/app/src/desktop-menu.ts packages/app/src/desktop-menu-copy.ts packages/app/src/desktop-menu.test.ts
git commit -m "feat(app): localize desktop menu copy"
```

### Task 2: Explicit Native Application Menu Labels

**Files:**
- Create: `packages/desktop/src/main/menu-template.ts`
- Create: `packages/desktop/src/main/menu-template.test.ts`
- Modify: `packages/desktop/src/main/menu.ts`

- [ ] **Step 1: Write failing pure-template tests**

Create `menu-template.test.ts` with injected no-op callbacks and assertions for Chinese top-level labels, explicit role labels, commands, and accelerators:

```ts
import { describe, expect, test } from "bun:test"
import { createDesktopMenuTemplate } from "./menu-template"

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
    "Agent Desktop Dev", "文件", "编辑", "显示", "前往", "窗口", "帮助",
  ])
  const edit = template.find((item) => item.label === "编辑")
  expect(edit?.submenu?.find((item) => item.role === "copy")?.label).toBe("复制")
  expect(edit?.submenu?.find((item) => item.role === "paste")?.label).toBe("粘贴")
  expect(edit?.submenu?.find((item) => item.role === "selectAll")?.label).toBe("全选")
})

test("preserves command callbacks and accelerators", () => {
  const commands: string[] = []
  const template = createDesktopMenuTemplate({
    locale: "zh",
    appName: "Agent Desktop Dev",
    updaterEnabled: false,
    trigger: (id) => commands.push(id),
    action: () => undefined,
    openExternal: () => undefined,
  })
  const file = template.find((item) => item.label === "文件")
  const settings = file?.submenu?.find((item) => item.label === "设置")
  settings?.click?.()
  expect(commands).toEqual(["settings.open"])
  expect(settings?.accelerator).toBe("Cmd+,")
})
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run from `packages/desktop`:

```bash
bun test src/main/menu-template.test.ts
```

Expected: FAIL because `menu-template.ts` does not exist.

- [ ] **Step 3: Implement the pure template builder**

Create a file that imports Electron types only and maps `DESKTOP_MENU` through `desktopMenuVisible` and `desktopMenuLabel`:

```ts
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuAction,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"
import { desktopMenuLabel } from "@opencode-ai/app/desktop-menu"

type Input = {
  locale: string
  appName: string
  updaterEnabled: boolean
  trigger: (id: string) => void
  action: (action: DesktopMenuAction) => void
  openExternal: (href: string) => void
}

export function createDesktopMenuTemplate(input: Input): MenuItemConstructorOptions[] {
  return DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => ({
    label: desktopMenuLabel(menu.label, input.locale, input.appName),
    role: menu.role ? nativeRole(menu.role) : undefined,
    submenu: menu.items
      ?.filter((entry) => desktopMenuVisible(entry, "macos"))
      .map((entry) => nativeItem(entry, input)),
  }))
}
```

`nativeItem` must always set the resolved `label`, plus `role`, `accelerator`, and updater `enabled`. A role item must keep its role and explicit label. Non-role items route command, action, and href clicks through the injected callbacks.

- [ ] **Step 4: Make menu installation use the pure template**

Change `createMenu` to accept `locale` and `appName`, call `createDesktopMenuTemplate`, and keep all Electron side effects in `menu.ts`:

```ts
Menu.setApplicationMenu(
  Menu.buildFromTemplate(
    createDesktopMenuTemplate({
      locale: deps.locale,
      appName: deps.appName,
      updaterEnabled: UPDATER_ENABLED,
      trigger: deps.trigger,
      action: (action) => runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, deps),
      openExternal: (href) => void shell.openExternal(href),
    }),
  ),
)
```

- [ ] **Step 5: Run template tests and desktop typecheck**

```bash
bun test src/main/menu-template.test.ts
bun typecheck
```

Expected: tests PASS and desktop typecheck exits 0.

- [ ] **Step 6: Commit native menu labels**

```bash
git add packages/desktop/src/main/menu.ts packages/desktop/src/main/menu-template.ts packages/desktop/src/main/menu-template.test.ts
git commit -m "feat(desktop): localize native application menu"
```

### Task 3: Localized Context Menu and Native UI Lifecycle

**Files:**
- Create: `packages/desktop/src/main/context-menu-labels.ts`
- Create: `packages/desktop/src/main/context-menu-labels.test.ts`
- Create: `packages/desktop/src/main/native-ui-controller.ts`
- Create: `packages/desktop/src/main/native-ui-controller.test.ts`

- [ ] **Step 1: Write failing context-copy and lifecycle tests**

The context copy test must assert exact Simplified Chinese labels and total key coverage:

```ts
import { expect, test } from "bun:test"
import { createContextMenuLabels } from "./context-menu-labels"

test("provides every supported Simplified Chinese context-menu label", () => {
  expect(createContextMenuLabels("zh")).toEqual({
    learnSpelling: "学习拼写",
    lookUpSelection: "查询“{selection}”",
    searchWithGoogle: "使用 Google 搜索",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
    saveImage: "保存图像",
    saveImageAs: "图像另存为...",
    saveVideo: "保存视频",
    saveVideoAs: "视频另存为...",
    copyLink: "复制链接",
    saveLinkAs: "链接另存为...",
    copyImage: "复制图像",
    copyImageAddress: "复制图像地址",
    copyVideoAddress: "复制视频地址",
    inspect: "检查元素",
    services: "服务",
  })
})
```

The lifecycle test uses injected installers:

```ts
test("rebuilds native surfaces once per actual locale change", () => {
  const menus: string[] = []
  const contexts: string[] = []
  const disposed: string[] = []
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: (locale) => menus.push(locale),
    installContextMenu: (locale) => {
      contexts.push(locale)
      return () => disposed.push(locale)
    },
  })
  controller.start()
  controller.enableApplicationMenu()
  controller.setLocale("zh")
  controller.setLocale("zh")
  expect(contexts).toEqual(["en", "zh"])
  expect(disposed).toEqual(["en"])
  expect(menus).toEqual(["en", "zh"])
})
```

- [ ] **Step 2: Run the focused tests and verify failures**

```bash
bun test src/main/context-menu-labels.test.ts src/main/native-ui-controller.test.ts
```

Expected: FAIL because both implementation modules are missing.

- [ ] **Step 3: Implement complete context-menu copy**

Use `import type { Labels } from "electron-context-menu"` and return `Required<Labels>`. Provide complete English, Simplified Chinese, and Traditional Chinese records. Resolve the locale through `normalizeDesktopMenuLocale` so unsupported renderer input falls back to English.

```ts
export function createContextMenuLabels(locale: string): Required<Labels> {
  return labels[normalizeDesktopMenuLocale(locale)]
}
```

- [ ] **Step 4: Implement the lifecycle controller**

Use a state object rather than mutable local variables:

```ts
export function createNativeUiController(options: {
  initialLocale: string
  installApplicationMenu: (locale: DesktopMenuLocale) => void
  installContextMenu: (locale: DesktopMenuLocale) => () => void
}) {
  const state = {
    locale: normalizeDesktopMenuLocale(options.initialLocale),
    started: false,
    menuEnabled: false,
    disposeContextMenu: undefined as (() => void) | undefined,
  }

  const refresh = () => {
    state.disposeContextMenu?.()
    state.disposeContextMenu = options.installContextMenu(state.locale)
    if (state.menuEnabled) options.installApplicationMenu(state.locale)
  }

  return {
    start() {
      if (state.started) return
      state.started = true
      refresh()
    },
    enableApplicationMenu() {
      if (state.menuEnabled) return
      state.menuEnabled = true
      options.installApplicationMenu(state.locale)
    },
    setLocale(value: string) {
      const locale = normalizeDesktopMenuLocale(value)
      if (locale === state.locale) return
      state.locale = locale
      if (state.started) refresh()
    },
    dispose() {
      state.disposeContextMenu?.()
      state.disposeContextMenu = undefined
      state.started = false
    },
  }
}
```

- [ ] **Step 5: Run lifecycle tests and typecheck**

```bash
bun test src/main/context-menu-labels.test.ts src/main/native-ui-controller.test.ts
bun typecheck
```

Expected: tests PASS and desktop typecheck exits 0.

- [ ] **Step 6: Commit context-menu localization**

```bash
git add packages/desktop/src/main/context-menu-labels.ts packages/desktop/src/main/context-menu-labels.test.ts packages/desktop/src/main/native-ui-controller.ts packages/desktop/src/main/native-ui-controller.test.ts
git commit -m "feat(desktop): localize native context menus"
```

### Task 4: Live Application-Locale Bridge

**Files:**
- Modify: `packages/app/src/context/platform.tsx`
- Modify: `packages/app/src/app.tsx`
- Create: `packages/desktop/src/preload/application-locale.ts`
- Create: `packages/desktop/src/preload/application-locale.test.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/main/index.ts`

- [ ] **Step 1: Add a failing preload contract test**

Create `application-locale.test.ts` against a pure setter factory:

```ts
import { expect, mock, test } from "bun:test"
import { createApplicationLocaleSetter } from "./application-locale"

test("uses the fixed application-locale IPC channel", async () => {
  const invoke = mock(async () => undefined)
  await createApplicationLocaleSetter(invoke)("zh")
  expect(invoke).toHaveBeenCalledWith("set-application-locale", "zh")
})
```

- [ ] **Step 2: Run the preload test and verify failure**

```bash
bun test src/preload/application-locale.test.ts
```

Expected: FAIL because `application-locale.ts` does not exist.

- [ ] **Step 3: Add the typed renderer-to-main bridge**

Create the fixed-channel setter:

```ts
export const APPLICATION_LOCALE_CHANNEL = "set-application-locale"

export function createApplicationLocaleSetter(invoke: (channel: string, locale: string) => Promise<unknown>) {
  return (locale: string) => invoke(APPLICATION_LOCALE_CHANNEL, locale).then(() => undefined)
}
```

Add to `ElectronAPI`:

```ts
setApplicationLocale: (locale: string) => Promise<void>
```

Expose it in preload:

```ts
setApplicationLocale: createApplicationLocaleSetter((channel, locale) => ipcRenderer.invoke(channel, locale)),
```

Add to `PlatformBase`:

```ts
/** Synchronize the application locale to native desktop surfaces. */
setApplicationLocale?(locale: string): Promise<void> | void
```

Implement it in the Electron platform:

```ts
setApplicationLocale: (locale) => window.api.setApplicationLocale(locale),
```

- [ ] **Step 4: Synchronize the language provider reactively**

In `UiI18nBridge`, use the already-provided platform context:

```tsx
function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  const platform = usePlatform()
  createEffect(() => {
    void platform.setApplicationLocale?.(language.locale())
  })
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}
```

- [ ] **Step 5: Wire the controller in the main process**

Remove the existing unlocalized top-level `contextMenu(...)` call. After `app.setPath("userData", ...)`, construct and start `createNativeUiController`:

```ts
const nativeUi = createNativeUiController({
  initialLocale: app.getLocale(),
  installApplicationMenu: (locale) =>
    createMenu({
      locale,
      appName: identity.name,
      trigger: (id) => {
        const win = getLastFocusedWindow()
        if (win) sendMenuCommand(win, id)
      },
      checkForUpdates: () => void showUpdaterDialog(updater, true),
      relaunch,
    }),
  installContextMenu: (locale) =>
    contextMenu({
      labels: createContextMenuLabels(locale),
      showSaveImageAs: true,
      showLookUpSelection: false,
      showSearchWithGoogle: false,
    }),
})
nativeUi.start()
```

Pass `setApplicationLocale: nativeUi.setLocale` into `registerIpcHandlers`, register this handler in `ipc.ts`, call `nativeUi.enableApplicationMenu()` after main windows are restored, and call `nativeUi.dispose()` in the existing shutdown cleanup path.

- [ ] **Step 6: Run bridge tests and package typechecks**

```bash
bun test src/preload/application-locale.test.ts src/main/native-ui-controller.test.ts
bun typecheck
```

Then from `packages/app`:

```bash
bun typecheck
```

Expected: all tests PASS and both typechecks exit 0.

- [ ] **Step 7: Commit the locale bridge**

```bash
git add packages/app/src/app.tsx packages/app/src/context/platform.tsx packages/desktop/src/main/index.ts packages/desktop/src/main/ipc.ts packages/desktop/src/preload/application-locale.ts packages/desktop/src/preload/application-locale.test.ts packages/desktop/src/preload/index.ts packages/desktop/src/preload/types.ts packages/desktop/src/renderer/index.tsx
git commit -m "feat(desktop): synchronize native menu locale"
```

### Task 5: Localize the Prompt Plus Menu and Adjacent Controls

**Files:**
- Modify: `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- Create: `packages/app/src/components/prompt-input-v2-copy.ts`
- Create: `packages/app/src/components/prompt-input-v2-copy.test.ts`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/app/src/i18n/zht.ts`
- Create: `packages/app/e2e/fixtures/localized-prompt-menu/index.html`
- Create: `packages/app/e2e/fixtures/localized-prompt-menu/main.tsx`
- Create: `packages/app/e2e/regression/localized-prompt-menu.spec.ts`

- [ ] **Step 1: Add a failing application-copy test**

Create `prompt-input-v2-copy.test.ts`:

```ts
import { expect, test } from "bun:test"
import { dict as zh } from "@/i18n/zh"
import { createPromptInputV2Copy } from "./prompt-input-v2-copy"

test("maps the complete Simplified Chinese prompt input copy", () => {
  const copy = createPromptInputV2Copy((key) => zh[key])
  expect(copy).toEqual({
    emptyResults: "没有匹配的结果",
    commandsSearchLabel: "命令",
    dropFiles: "将图片、PDF 或文本文件拖放到此处",
    removeAttachment: "移除附件",
    promptLabel: "提示词",
    addTitle: "添加文件及更多内容",
    attach: "图片和文件",
    commands: "命令",
    context: "上下文",
    shell: "Shell 命令",
    chooseAgent: "切换智能体",
    chooseModel: "选择模型",
    chooseVariant: "切换思考强度",
    send: "发送",
    stop: "停止",
  })
})
```

- [ ] **Step 2: Run the copy test and verify the missing module failure**

```bash
bun test --conditions=solid --preload ./happydom.ts src/components/prompt-input-v2-copy.test.ts
```

Expected: FAIL because `prompt-input-v2-copy.ts` does not exist.

- [ ] **Step 3: Add typed prompt copy with English defaults**

In the shared prompt component export:

```ts
export type PromptInputV2Copy = {
  emptyResults: string
  commandsSearchLabel: string
  dropFiles: string
  removeAttachment: string
  promptLabel: string
  addTitle: string
  attach: string
  commands: string
  context: string
  shell: string
  chooseAgent: string
  chooseModel: string
  chooseVariant: string
  send: string
  stop: string
}

const DEFAULT_COPY: PromptInputV2Copy = {
  emptyResults: "No matching items",
  commandsSearchLabel: "Commands",
  dropFiles: "Drop files to attach",
  removeAttachment: "Remove attachment",
  promptLabel: "Prompt",
  addTitle: "Add images and files",
  attach: "Images and files",
  commands: "Commands",
  context: "Context",
  shell: "Shell command",
  chooseAgent: "Choose agent",
  chooseModel: "Choose model",
  chooseVariant: "Choose model variant",
  send: "Send",
  stop: "Stop",
}
```

Add `copy?: Partial<PromptInputV2Copy>` to props and resolve it with `const copy = createMemo(() => ({ ...DEFAULT_COPY, ...props.copy }))`. Replace every matching hardcoded string in the component with `copy()`. Keep fallback placeholders unchanged because the app supplies its own localized placeholder accessor.

- [ ] **Step 4: Map application translations to the shared copy type**

Create `prompt-input-v2-copy.ts`:

```ts
import type { PromptInputV2Copy } from "@opencode-ai/session-ui/v2/prompt-input"
import { dict as en } from "@/i18n/en"

export function createPromptInputV2Copy(t: (key: keyof typeof en) => string): PromptInputV2Copy {
  return {
    emptyResults: t("prompt.popover.emptyResults"),
    commandsSearchLabel: t("prompt.menu.commands"),
    dropFiles: t("prompt.dropzone.label"),
    removeAttachment: t("prompt.attachment.remove"),
    promptLabel: t("prompt.mode.normal"),
    addTitle: t("prompt.menu.addImagesAndFiles"),
    attach: t("prompt.menu.imagesAndFiles"),
    commands: t("prompt.menu.commands"),
    context: t("prompt.menu.context"),
    shell: t("prompt.menu.shellCommand"),
    chooseAgent: t("command.agent.cycle"),
    chooseModel: t("command.model.choose"),
    chooseVariant: t("command.model.variant.cycle"),
    send: t("prompt.action.send"),
    stop: t("prompt.action.stop"),
  }
}
```

Change `prompt.mode.normal` to `提示词` in `zh.ts` and `提示詞` in `zht.ts`, then run the copy test and expect PASS. Preserve `prompt.menu.shellCommand` as `Shell 命令`/`Shell 指令` so the shell product term remains recognizable while the action word is Chinese.

- [ ] **Step 5: Pass tested application copy into PromptInputV2**

In `PromptInputV2Composer`, import the mapping and pass:

```tsx
copy={createPromptInputV2Copy(language.t)}
```

- [ ] **Step 6: Add the rendered plus-menu fixture and test**

Create the fixture HTML with a `#root` and `./main.tsx`. In `main.tsx`, build the copy through `createPromptInputV2Copy((key) => zh[key])` and render `PromptInputV2AddMenu` with `copy.addTitle`, `copy.attach`, `copy.commands`, `copy.context`, and `copy.shell`.

Create the Playwright test:

```ts
import { expect, test } from "@playwright/test"

test("shows a fully localized Simplified Chinese prompt add menu", async ({ page }) => {
  await page.goto("/e2e/fixtures/localized-prompt-menu/")
  await page.getByRole("button", { name: "添加文件及更多内容" }).click()
  await expect(page.getByRole("menuitem")).toHaveText(["图片和文件", "命令/", "上下文@", "Shell 命令!"])
})
```

- [ ] **Step 7: Run browser, unit, parity, and type checks**

From `packages/app`:

```bash
PLAYWRIGHT_PORT=3118 PLAYWRIGHT_WORKERS=1 bunx playwright test e2e/regression/localized-prompt-menu.spec.ts
bun test --conditions=solid --preload ./happydom.ts src/components/prompt-input-v2-copy.test.ts
bun test --conditions=solid --preload ./happydom.ts src/i18n/parity.test.ts
bun typecheck
bun run typecheck:e2e
```

From `packages/session-ui`:

```bash
bun typecheck
```

Expected: Playwright PASS, locale parity PASS, and all typechecks exit 0.

- [ ] **Step 8: Commit prompt localization**

```bash
git add packages/session-ui/src/v2/components/prompt-input/index.tsx packages/app/src/components/prompt-input-v2-copy.ts packages/app/src/components/prompt-input-v2-copy.test.ts packages/app/src/components/prompt-input-v2.tsx packages/app/src/i18n/zh.ts packages/app/src/i18n/zht.ts packages/app/e2e/fixtures/localized-prompt-menu/index.html packages/app/e2e/fixtures/localized-prompt-menu/main.tsx packages/app/e2e/regression/localized-prompt-menu.spec.ts
git commit -m "feat(app): localize prompt add menu"
```

### Task 6: Completion Audit, Build, Package, and Mac QA

**Files:**
- Verify all files changed since `aab5a4756`
- Package output: `packages/desktop/dist/agent-desktop-dev-mac-arm64.dmg`

- [ ] **Step 1: Run the complete focused regression suite**

From `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/desktop-menu.test.ts src/components/prompt-input-v2-copy.test.ts src/i18n/parity.test.ts
bun typecheck
bun run typecheck:e2e
PLAYWRIGHT_PORT=3118 PLAYWRIGHT_WORKERS=1 bunx playwright test e2e/regression/localized-prompt-menu.spec.ts
bun run build
```

From `packages/session-ui`:

```bash
bun typecheck
```

From `packages/desktop`:

```bash
bun test src/main/menu-template.test.ts src/main/context-menu-labels.test.ts src/main/native-ui-controller.test.ts src/preload/product-host.test.ts src/preload/application-locale.test.ts
bun typecheck
OPENCODE_MODELS_URL=https://models.opencode.ai bun run build
bun run package:mac --arm64
```

Expected: every test and typecheck passes, both builds exit 0, and unsigned arm64 DMG/ZIP artifacts are produced.

- [ ] **Step 2: Audit source coverage against the objective**

Run from the repository root:

```bash
rg -n 'label: "(File|Edit|View|Go|Window|Help|Copy|Paste|Cut|Select All)"|Add images and files|Images and files|Commands|Context|Shell command' packages/app/src/desktop-menu.ts packages/desktop/src/main packages/session-ui/src/v2/components/prompt-input/index.tsx
git diff --check
git status --short
```

Expected: no unresolved user-visible English literals in the three target surfaces, no whitespace errors, and only the user's pre-existing `.superpowers/` remains untracked.

- [ ] **Step 3: Verify the packaged prompt menu with agent-browser**

Launch the packaged app with an isolated profile and CDP port, connect agent-browser, open a new task, click the plus button, and capture a snapshot. Required visible labels:

```text
图片和文件
命令
上下文
Shell 命令
```

Also assert the button accessible name is `添加文件及更多内容`.

- [ ] **Step 4: Verify native menus with macOS UI automation**

Using the packaged app in Simplified Chinese application locale:

1. Open each top-level menu and capture the visible items.
2. Confirm top labels are `文件`, `编辑`, `显示`, `前往`, `窗口`, `帮助`.
3. Confirm the Edit menu includes `撤销`, `重做`, `剪切`, `复制`, `粘贴`, `删除`, `全选`.
4. Right-click editable prompt text and confirm `剪切`, `复制`, `粘贴`, `全选`.
5. Right-click a rendered link or image and confirm the applicable `复制链接`, `复制图像`, or `图像另存为...` label.
6. Switch the application language to English and back to Simplified Chinese without restarting; reopen native menus and confirm they refresh.

- [ ] **Step 5: Close all QA processes and compute artifact hashes**

Close agent-browser sessions, terminate only the isolated packaged app and mock/test servers, verify QA ports have no listeners, then run:

```bash
shasum -a 256 packages/desktop/dist/agent-desktop-dev-mac-arm64.dmg packages/desktop/dist/agent-desktop-dev-mac-arm64.zip
```

- [ ] **Step 6: Final review and goal completion**

Review `git diff aab5a4756^..HEAD`, confirm no protected runtime files under `packages/core`, `packages/opencode`, `packages/server`, or `packages/protocol` changed, and confirm every design requirement has direct test or packaged-runtime evidence. Mark the active goal complete only after all three target menu surfaces pass packaged verification.

import type { DesktopMenuLabel } from "./desktop-menu-copy"

export { desktopMenuLabel, normalizeDesktopMenuLocale } from "./desktop-menu-copy"
export type { DesktopMenuLabel, DesktopMenuLocale } from "./desktop-menu-copy"

export type DesktopMenuPlatform = "macos" | "windows"

export type DesktopMenuAction =
  | "app.checkForUpdates"
  | "app.relaunch"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.reload"
  | "view.toggleDevTools"
  | "view.resetZoom"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleFullscreen"
  | "window.new"
  | "window.close"
  | "window.minimize"
  | "window.toggleMaximize"

export type DesktopMenuRole =
  | "about"
  | "close"
  | "copy"
  | "cut"
  | "hide"
  | "hideOthers"
  | "paste"
  | "quit"
  | "redo"
  | "reload"
  | "resetZoom"
  | "selectAll"
  | "toggleDevTools"
  | "togglefullscreen"
  | "undo"
  | "unhide"
  | "windowMenu"
  | "zoomIn"
  | "zoomOut"

export type DesktopMenuItem = {
  type: "item"
  label: DesktopMenuLabel
  command?: string
  action?: DesktopMenuAction
  role?: DesktopMenuRole
  href?: string
  accelerator?: Partial<Record<DesktopMenuPlatform, string>>
  enabled?: "updater"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuSeparator = {
  type: "separator"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuEntry = DesktopMenuItem | DesktopMenuSeparator

export type DesktopMenu = {
  id: string
  label: DesktopMenuLabel
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "app",
    label: "menu.app",
    platforms: ["macos"],
    items: [
      { type: "item", label: "app.about", role: "about" },
      { type: "item", label: "app.checkForUpdates", action: "app.checkForUpdates", enabled: "updater" },
      { type: "item", label: "app.settings", command: "settings.open", accelerator: { macos: "Cmd+," } },
      { type: "item", label: "app.reloadWebview", action: "view.reload" },
      { type: "item", label: "app.restart", action: "app.relaunch" },
      { type: "item", label: "app.exportLogs", command: "logs.export" },
      { type: "separator" },
      { type: "item", label: "app.hide", role: "hide" },
      { type: "item", label: "app.hideOthers", role: "hideOthers" },
      { type: "item", label: "app.showAll", role: "unhide" },
      { type: "separator" },
      { type: "item", label: "app.quit", role: "quit" },
    ],
  },
  {
    id: "file",
    label: "menu.file",
    items: [
      {
        type: "item",
        label: "file.newTask",
        command: "session.new",
        accelerator: { macos: "Shift+Cmd+S" },
      },
      { type: "item", label: "file.openProject", command: "project.open", accelerator: { macos: "Cmd+O" } },
      {
        type: "item",
        label: "app.settings",
        command: "settings.open",
        accelerator: { windows: "Ctrl+," },
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "file.newWindow",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      { type: "item", label: "file.closeWindow", action: "window.close", role: "close" },
    ],
  },
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
      {
        type: "item",
        label: "edit.selectAll",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "menu.view",
    items: [
      { type: "item", label: "view.toggleSidebar", command: "sidebar.toggle" },
      { type: "item", label: "view.toggleTerminal", command: "terminal.toggle", accelerator: { macos: "Ctrl+`" } },
      { type: "item", label: "view.toggleFileTree", command: "fileTree.toggle" },
      { type: "separator" },
      { type: "item", label: "view.reload", action: "view.reload", role: "reload" },
      {
        type: "item",
        label: "view.toggleDeveloperTools",
        action: "view.toggleDevTools",
        role: "toggleDevTools",
      },
      { type: "separator" },
      {
        type: "item",
        label: "view.actualSize",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { windows: "Ctrl+0" },
      },
      {
        type: "item",
        label: "view.zoomIn",
        action: "view.zoomIn",
        role: "zoomIn",
        accelerator: { windows: "Ctrl++" },
      },
      {
        type: "item",
        label: "view.zoomOut",
        action: "view.zoomOut",
        role: "zoomOut",
        accelerator: { windows: "Ctrl+-" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "view.toggleFullScreen",
        action: "view.toggleFullscreen",
        role: "togglefullscreen",
      },
    ],
  },
  {
    id: "go",
    label: "menu.go",
    items: [
      { type: "item", label: "go.back", command: "common.goBack", accelerator: { macos: "Cmd+[" } },
      { type: "item", label: "go.forward", command: "common.goForward", accelerator: { macos: "Cmd+]" } },
      { type: "separator" },
      { type: "item", label: "go.previousTask", command: "session.previous", accelerator: { macos: "Option+Up" } },
      { type: "item", label: "go.nextTask", command: "session.next", accelerator: { macos: "Option+Down" } },
      { type: "separator" },
      {
        type: "item",
        label: "go.previousProject",
        command: "project.previous",
        accelerator: { macos: "Cmd+Option+Up" },
      },
      {
        type: "item",
        label: "go.nextProject",
        command: "project.next",
        accelerator: { macos: "Cmd+Option+Down" },
      },
    ],
  },
  {
    id: "window",
    label: "menu.window",
    role: "windowMenu",
    items: [
      { type: "item", label: "window.minimize", action: "window.minimize" },
      { type: "item", label: "window.maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", label: "file.closeWindow", action: "window.close" },
    ],
  },
  {
    id: "help",
    label: "menu.help",
    items: [
      { type: "item", label: "help.documentation", href: "https://opencode.ai/docs" },
      { type: "item", label: "help.supportForum", href: "https://discord.com/invite/opencode" },
      { type: "item", label: "app.exportLogs", command: "logs.export" },
      { type: "separator" },
      {
        type: "item",
        label: "help.shareFeedback",
        href: "https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml",
      },
      {
        type: "item",
        label: "help.reportBug",
        href: "https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml",
      },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}

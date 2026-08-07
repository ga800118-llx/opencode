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

const copy = {
  en: {
    "menu.app": "{appName}",
    "menu.file": "File",
    "menu.edit": "Edit",
    "menu.view": "View",
    "menu.go": "Go",
    "menu.window": "Window",
    "menu.help": "Help",
    "app.about": "About {appName}",
    "app.checkForUpdates": "Check for Updates...",
    "app.settings": "Settings",
    "app.reloadWebview": "Reload Webview",
    "app.restart": "Restart",
    "app.exportLogs": "Export Logs...",
    "app.hide": "Hide {appName}",
    "app.hideOthers": "Hide Others",
    "app.showAll": "Show All",
    "app.quit": "Quit {appName}",
    "file.newTask": "New Task",
    "file.openProject": "Open Project...",
    "file.newWindow": "New Window",
    "file.closeWindow": "Close Window",
    "edit.undo": "Undo",
    "edit.redo": "Redo",
    "edit.cut": "Cut",
    "edit.copy": "Copy",
    "edit.paste": "Paste",
    "edit.delete": "Delete",
    "edit.selectAll": "Select All",
    "view.toggleSidebar": "Toggle Sidebar",
    "view.toggleTerminal": "Toggle Terminal",
    "view.toggleFileTree": "Toggle File Tree",
    "view.reload": "Reload",
    "view.toggleDeveloperTools": "Toggle Developer Tools",
    "view.actualSize": "Actual Size",
    "view.zoomIn": "Zoom In",
    "view.zoomOut": "Zoom Out",
    "view.toggleFullScreen": "Toggle Full Screen",
    "go.back": "Back",
    "go.forward": "Forward",
    "go.previousTask": "Previous Task",
    "go.nextTask": "Next Task",
    "go.previousProject": "Previous Project",
    "go.nextProject": "Next Project",
    "window.minimize": "Minimize",
    "window.maximize": "Maximize",
    "help.documentation": "OpenCode Documentation",
    "help.supportForum": "Support Forum",
    "help.shareFeedback": "Share Feedback",
    "help.reportBug": "Report a Bug",
  },
  zh: {
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
  },
  zht: {
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
  },
} satisfies Record<DesktopMenuLocale, Record<DesktopMenuLabel, string>>

export function normalizeDesktopMenuLocale(value: string): DesktopMenuLocale {
  if (value === "zh" || value === "zht") return value
  return "en"
}

export function desktopMenuLabel(label: DesktopMenuLabel, locale: string, appName: string) {
  return copy[normalizeDesktopMenuLocale(locale)][label].replaceAll("{appName}", () => appName)
}

import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuLabel,
  desktopMenuVisible,
  type DesktopMenuAction,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"

type Input = {
  locale: string
  appName: string
  updaterEnabled: boolean
  trigger: (id: string) => void
  action: (action: DesktopMenuAction) => void
  openExternal: (href: string) => void
}

export function createDesktopMenuTemplate(input: Input) {
  return DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => ({
    label: desktopMenuLabel(menu.label, input.locale, input.appName),
    role: menu.role ? nativeRole(menu.role) : undefined,
    submenu: menu.items
      ?.filter((entry) => desktopMenuVisible(entry, "macos"))
      .map((entry) => nativeItem(entry, input)),
  }))
}

function nativeItem(entry: DesktopMenuEntry, input: Input): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }

  const item: MenuItemConstructorOptions = {
    label: desktopMenuLabel(entry.label, input.locale, input.appName),
    accelerator: entry.accelerator?.macos,
    enabled: entry.enabled === "updater" ? input.updaterEnabled : undefined,
  }

  if (entry.role) return { ...item, role: nativeRole(entry.role) }
  if (entry.command) {
    const command = entry.command
    item.click = () => input.trigger(command)
  }
  if (entry.action) {
    const action = entry.action
    item.click = () => input.action(action)
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => input.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}

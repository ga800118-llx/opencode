import { BrowserWindow, Menu, shell } from "electron"
import type { DesktopMenuLocale } from "@opencode-ai/app/desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { createDesktopMenuTemplate } from "./menu-template"

type Deps = {
  locale: DesktopMenuLocale
  appName: string
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createDesktopMenuTemplate({
        locale: deps.locale,
        appName: deps.appName,
        updaterEnabled: UPDATER_ENABLED,
        trigger: deps.trigger,
        action: (action) =>
          runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
            checkForUpdates: deps.checkForUpdates,
            relaunch: deps.relaunch,
          }),
        openExternal: (href) => void shell.openExternal(href),
      }),
    ),
  )
}

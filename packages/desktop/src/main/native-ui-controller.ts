import { normalizeDesktopMenuLocale, type DesktopMenuLocale } from "@opencode-ai/app/desktop-menu"

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

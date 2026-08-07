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

  const install = (locale: DesktopMenuLocale, restoreMenuLocale?: DesktopMenuLocale) => {
    const disposeContextMenu = options.installContextMenu(locale)
    if (!state.menuEnabled) return disposeContextMenu

    try {
      options.installApplicationMenu(locale)
      return disposeContextMenu
    } catch (error) {
      const failures = [error]
      try {
        disposeContextMenu()
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
      if (restoreMenuLocale) {
        try {
          options.installApplicationMenu(restoreMenuLocale)
        } catch (restoreError) {
          failures.push(restoreError)
        }
      }
      if (failures.length === 1) throw error
      throw new AggregateError(failures, `Failed to install native UI for locale ${locale}`)
    }
  }

  return {
    start() {
      if (state.started) return
      const disposeContextMenu = install(state.locale)
      state.disposeContextMenu = disposeContextMenu
      state.started = true
    },
    enableApplicationMenu() {
      if (state.menuEnabled) return
      options.installApplicationMenu(state.locale)
      state.menuEnabled = true
    },
    setLocale(value: string) {
      const locale = normalizeDesktopMenuLocale(value)
      if (locale === state.locale) return
      if (!state.started) {
        state.locale = locale
        return
      }

      const disposeContextMenu = install(locale, state.locale)
      const disposePreviousContextMenu = state.disposeContextMenu
      state.disposeContextMenu = disposeContextMenu
      state.locale = locale
      disposePreviousContextMenu?.()
    },
    dispose() {
      const disposeContextMenu = state.disposeContextMenu
      state.disposeContextMenu = undefined
      state.started = false
      disposeContextMenu?.()
    },
  }
}

import type { DesktopMenuLocale } from "@opencode-ai/app/desktop-menu"
import type { Labels } from "electron-context-menu"

type MutableLabels = {
  -readonly [Key in keyof Required<Labels>]: Required<Labels>[Key]
}

type Lease = {
  labels: Required<Labels>
}

export function createContextMenuInstaller(options: {
  createLabels: (locale: DesktopMenuLocale) => Required<Labels>
  register: (labels: Required<Labels>) => () => void
}) {
  const state = {
    labels: undefined as MutableLabels | undefined,
    disposeContextMenu: undefined as (() => void) | undefined,
    leases: [] as Lease[],
  }

  return (locale: DesktopMenuLocale) => {
    const next = options.createLabels(locale)
    if (state.labels) {
      Object.assign(state.labels, next)
    } else {
      const labels = { ...next }
      const disposeContextMenu = options.register(labels)
      state.labels = labels
      state.disposeContextMenu = disposeContextMenu
    }

    const lease = { labels: next }
    state.leases.push(lease)

    return () => {
      const index = state.leases.indexOf(lease)
      if (index < 0) return
      const active = index === state.leases.length - 1
      state.leases.splice(index, 1)
      if (!active) return

      const previous = state.leases.at(-1)
      if (previous && state.labels) {
        Object.assign(state.labels, previous.labels)
        return
      }

      const disposeContextMenu = state.disposeContextMenu
      state.labels = undefined
      state.disposeContextMenu = undefined
      disposeContextMenu?.()
    }
  }
}

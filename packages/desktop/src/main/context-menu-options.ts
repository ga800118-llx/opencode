import type { Labels, Options } from "electron-context-menu"

export function createContextMenuOptions(labels: Required<Labels>): Options {
  return {
    labels,
    showSelectAll: true,
    showSaveImageAs: true,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
  }
}

export type DesktopProductPresentation = Readonly<{
  name: string
  recovery: Readonly<{
    loadFailed: string
    processGone: string
    unresponsive: string
  }>
}>

export function createDesktopProductPresentation(name: string): DesktopProductPresentation {
  return Object.freeze({
    name,
    recovery: Object.freeze({
      loadFailed: `${name} failed to load`,
      processGone: `${name} window terminated unexpectedly`,
      unresponsive: `${name} is not responding`,
    }),
  })
}

export function preserveDesktopWindowTitle(
  presentation: DesktopProductPresentation,
  event: { preventDefault: () => void },
  win: { setTitle: (title: string) => void },
) {
  event.preventDefault()
  win.setTitle(presentation.name)
}

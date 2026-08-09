import type { LayoutRoute } from "@/context/layout"
import type { DraftTab, Tab, TabInfo } from "@/context/tabs"

export function settingsDirectory(
  route: LayoutRoute,
  tabs: ReadonlyArray<Tab>,
  session: (sessionID: string) => { directory: string } | undefined,
  info: (tab: Tab) => TabInfo | undefined = () => undefined,
) {
  if (route.type === "dir-new-sesssion") return route.dir
  if (route.type === "draft")
    return tabs.find((item): item is DraftTab => item.type === "draft" && item.draftID === route.draftID)?.directory
  if (route.type === "session") {
    const current = session(route.sessionId)?.directory
    if (current) return current
    const tab = tabs.find(
      (item) =>
        item.type === "session" &&
        item.sessionId === route.sessionId &&
        (!route.server || item.server === route.server),
    )
    return tab ? info(tab)?.directory : undefined
  }
  return undefined
}

export function settingsSkillDirectory(directory: string | undefined, globalConfig: string | undefined) {
  return directory ?? globalConfig
}

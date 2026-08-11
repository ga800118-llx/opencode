import { useGlobal } from "@/context/global"
import { type HomeProjectSelection, useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { useSettings } from "@/context/settings"
import { toggleHomeProjectSelection } from "@/pages/layout/helpers"
import { visibleRunLocations } from "@/product/workflow"
import { createEffect, createMemo } from "solid-js"

export function createHomeController() {
  const sync = useServerSync()
  const layout = useLayout()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const settings = useSettings()
  const selection = layout.home.selection
  const servers = createMemo(() =>
    visibleRunLocations({
      mode: settings.general.presentationMode(),
      current: server.current,
      list: global.servers.list(),
    }),
  )
  const focusedServer = createMemo(
    () => servers().find((conn) => ServerConnection.key(conn) === selection().server) ?? servers()[0],
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const recentlyClosed = createMemo(
    () => focusedServerCtx()?.projects.recentlyClosed() ?? layout.projects.recentlyClosed(),
  )
  const homedir = createMemo(() => focusedSync().data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )
  const newSessionPending = createMemo(() => {
    const conn = focusedServer()
    const project = newSessionProject()
    if (!conn || !project) return false
    return tabs.draftPending(ServerConnection.key(conn), project.worktree)
  })

  createEffect(() => {
    const list = servers()
    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    return tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  return {
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: servers,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      newSessionPending,
      pending: (conn: ServerConnection.Any, directory: string) =>
        tabs.draftPending(ServerConnection.key(conn), directory),
      forServer: (conn: ServerConnection.Any) => global.ensureServerCtx(conn).projects.list(),
      select: (conn: ServerConnection.Any, directory: string) => {
        const key = ServerConnection.key(conn)
        if (global.servers.health[key]?.healthy === false) return
        if (
          !global
            .ensureServerCtx(conn)
            .projects.list()
            .some((project) => project.worktree === directory)
        )
          return
        setSelection(toggleHomeProjectSelection(selection(), key, directory))
      },
      add: (conn: ServerConnection.Any, directories: string[]) => {
        const directory = directories[0]
        if (!directory) return
        const ctx = global.ensureServerCtx(conn)
        directories.forEach((item) => ctx.projects.open(item))
        ctx.projects.touch(directory)
        setSelection({ server: ServerConnection.key(conn), directory })
      },
      openNewSession: () => {
        const conn = focusedServer()
        const project = newSessionProject()
        if (!conn || !project) return
        openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>

import { getFilename } from "@opencode-ai/core/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { normalizeProjectInfo } from "@/context/global-sync/utils"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobal } from "@/context/global"
import { type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { persistProjectMetadata, projectMetadataErrorMessage } from "@/context/project-metadata"

export function createEditProjectModel(props: { project: LocalProject; server: ServerConnection.Any }) {
  const dialog = useDialog()
  const global = useGlobal()
  const serverCtx = createMemo(() => global.ensureServerCtx(props.server))
  const folderName = createMemo(() => getFilename(props.project.worktree))
  const defaultName = createMemo(() => props.project.name || folderName())
  const [store, setStore] = createStore({
    name: defaultName(),
    color: props.project.icon?.color,
    iconOverride: props.project.icon?.override,
    startup: props.project.commands?.start ?? "",
    dragOver: false,
    iconHover: false,
  })
  let iconInput: HTMLInputElement | undefined

  function selectFile(file: File) {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result
      if (typeof result !== "string") return
      setStore("iconOverride", result)
      setStore("iconHover", false)
    }
    reader.readAsDataURL(file)
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    setStore("dragOver", false)
    const file = event.dataTransfer?.files[0]
    if (file) selectFile(file)
  }

  function dragOver(event: DragEvent) {
    event.preventDefault()
    setStore("dragOver", true)
  }

  function dragLeave() {
    setStore("dragOver", false)
  }

  function inputChange(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (file) selectFile(file)
  }

  function iconClick() {
    if (store.iconOverride && store.iconHover) {
      setStore("iconOverride", "")
      return
    }
    iconInput?.click()
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      const name = store.name.trim() === folderName() ? "" : store.name.trim()
      const start = store.startup.trim()
      const patch = {
        name,
        icon: { color: store.color ?? "", override: store.iconOverride ?? "" },
        commands: { start },
      }

      return persistProjectMetadata({
        protocol: await serverCtx().sdk.protocol,
        project: props.project,
        patch,
        updateServer: async (input) => {
          const project = await serverCtx()
            .sdk.client.project.update({
              projectID: input.projectID,
              directory: input.directory,
              ...input.patch,
            })
            .then((result) => result.data)
          if (!project) return
          return { ...props.project, ...normalizeProjectInfo(project), expanded: props.project.expanded }
        },
        writeLocal: (next) => {
          serverCtx().sync.project.meta(props.project.worktree, next)
          if (next.icon?.override !== undefined) {
            serverCtx().sync.project.icon(props.project.worktree, next.icon.override)
          }
        },
        updateProjection: (project) => {
          if (!project.id) return
          serverCtx().sync.set("project", (items) =>
            items.map((item) =>
              item.id === project.id
                ? {
                    ...item,
                    ...project,
                    icon: { ...item.icon, ...project.icon },
                    commands: { ...item.commands, ...project.commands },
                  }
                : item,
            ),
          )
        },
      })
    },
    onSuccess: () => dialog.close(),
  }))

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (save.isPending) return
    save.mutate()
  }

  return {
    store,
    setStore,
    folderName,
    defaultName,
    save,
    error(fallback: string) {
      if (!save.error) return
      return projectMetadataErrorMessage(save.error, fallback)
    },
    submit,
    drop,
    dragOver,
    dragLeave,
    inputChange,
    iconClick,
    close() {
      dialog.close()
    },
    setIconInput(input: HTMLInputElement) {
      iconInput = input
    },
  }
}

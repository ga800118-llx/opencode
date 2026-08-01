import { createPromptProjectController } from "@/components/prompt-project-selector"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useSettings } from "@/context/settings"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useModelReadiness } from "@/product/workflow/use-model-readiness"
import { createEffect, createMemo, createResource } from "solid-js"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { createNewSessionPresentation } from "./new-session/new-session-presentation"
import { NewSessionStatus, NewSessionView } from "./new-session/new-session-view"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const settings = useSettings()
  const local = useLocal()
  const sdk = useSDK()
  const rightMount = useTitlebarRightMount()
  const workspace = createNewSessionWorkspaceController()
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  const presentation = createMemo(() => createNewSessionPresentation(settings.general.presentationMode()))
  const modelReadiness = useModelReadiness({ directory: () => sdk().directory, model: local.model })
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <NewSessionStatus mount={rightMount} visible={settings.visibility.status} />
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <NewSessionView
          input={draft.input}
          project={project}
          workspace={workspace}
          modelReadiness={modelReadiness.readiness}
          presentation={presentation}
        />
      </div>
    </div>
  )
}

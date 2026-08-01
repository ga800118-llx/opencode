import { type Accessor, type ParentProps } from "solid-js"
import { SidecarRecoveryNotice } from "./sidecar-recovery-notice"

export type RecoveryShellLayout = "new" | "legacy"

export function recoveryShellSelection(newLayoutDesigns: boolean) {
  return {
    boundary: "app-interface" as const,
    layout: newLayoutDesigns ? ("new" as const) : ("legacy" as const),
  }
}

export function RecoveryShell(props: ParentProps<{ layout: Accessor<RecoveryShellLayout> }>) {
  return (
    <div
      data-component="recovery-shell"
      data-boundary="app-interface"
      data-layout={props.layout()}
      class="relative flex size-full min-h-0 min-w-0 flex-col"
    >
      <SidecarRecoveryNotice />
      <div data-component="recovery-shell-content" class="flex min-h-0 min-w-0 flex-1">
        {props.children}
      </div>
    </div>
  )
}

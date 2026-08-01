import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SidecarRecoveryState } from "@/product/workflow/sidecar-status"
import {
  useSidecarRecovery,
  type SidecarRecoveryActionState,
} from "@/product/workflow/use-sidecar-recovery"

const failureDescriptions = {
  start: "workflow.sidecar.failure.start",
  health: "workflow.sidecar.failure.health",
  exit: "workflow.sidecar.failure.exit",
  stopped: "workflow.sidecar.failure.stopped",
  unknown: "workflow.sidecar.failure.unknown",
} as const

export type SidecarRecoveryNoticeInput = {
  readonly state: SidecarRecoveryState
  readonly restartState: SidecarRecoveryActionState
  readonly diagnosticsAvailable: boolean
  readonly diagnosticsState: SidecarRecoveryActionState
}

export function sidecarRecoveryNoticeViewModel(input: SidecarRecoveryNoticeInput) {
  if (input.state.kind === "hidden") return
  if (input.state.kind === "progress") {
    return {
      kind: "progress" as const,
      role: "status" as const,
      live: "polite" as const,
      description:
        input.state.phase === "starting"
          ? ("workflow.sidecar.progress.starting" as const)
          : ("workflow.sidecar.progress.restarting" as const),
    }
  }

  return {
    kind: "failure" as const,
    role: "alert" as const,
    description: failureDescriptions[input.state.category],
    restart: {
      label:
        input.restartState === "pending"
          ? ("workflow.sidecar.action.restarting" as const)
          : input.restartState === "failed"
            ? ("workflow.sidecar.action.restartRetry" as const)
            : ("workflow.sidecar.action.restart" as const),
      pending: input.restartState === "pending",
    },
    diagnostics: input.diagnosticsAvailable
      ? {
          label:
            input.diagnosticsState === "pending"
              ? ("workflow.sidecar.action.exporting" as const)
              : input.diagnosticsState === "failed"
                ? ("workflow.sidecar.action.diagnosticsRetry" as const)
                : ("workflow.sidecar.action.diagnostics" as const),
          pending: input.diagnosticsState === "pending",
        }
      : undefined,
  }
}

export function SidecarRecoveryNotice() {
  const language = useLanguage()
  const recovery = useSidecarRecovery()
  const notice = () =>
    sidecarRecoveryNoticeViewModel({
      state: recovery.state(),
      restartState: recovery.restartState(),
      diagnosticsAvailable: recovery.diagnostics.available,
      diagnosticsState: recovery.diagnosticsState(),
    })

  return (
    <Show when={notice()}>
      {(current) => (
        <section
          data-component="sidecar-recovery-notice"
          data-state={current().kind}
          role={current().role}
          aria-live={current().kind === "progress" ? current().live : undefined}
          class="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-2 sm:px-4"
        >
          <div class="flex min-w-0 flex-1 basis-full items-start gap-2 sm:basis-auto">
            <IconV2
              name={current().kind === "failure" ? "warning" : "outline-reset"}
              size="small"
              class="mt-0.5 shrink-0 text-v2-icon-icon-muted"
            />
            <p class="min-w-0 flex-1 whitespace-normal break-words text-[13px] leading-5 text-v2-text-text-muted">
              {language.t(current().description)}
            </p>
          </div>
          <Show when={current().kind === "failure" ? current().restart : undefined}>
            {(action) => (
              <ButtonV2
                data-action="restart-agent-service"
                size="small"
                variant="warning"
                icon="outline-reset"
                disabled={action().pending}
                aria-busy={action().pending ? "true" : undefined}
                class="shrink-0"
                onClick={() => void recovery.restart()}
              >
                {language.t(action().label)}
              </ButtonV2>
            )}
          </Show>
          <Show when={current().kind === "failure" ? current().diagnostics : undefined}>
            {(action) => (
              <ButtonV2
                data-action="export-agent-diagnostics"
                size="small"
                variant="neutral"
                icon="arrow-down-to-line"
                disabled={action().pending}
                aria-busy={action().pending ? "true" : undefined}
                class="shrink-0"
                onClick={() => void recovery.exportDiagnostics()}
              >
                {language.t(action().label)}
              </ButtonV2>
            )}
          </Show>
        </section>
      )}
    </Show>
  )
}

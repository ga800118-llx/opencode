import { Show, createUniqueId } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

export function SessionCompactionControl(props: {
  label: string
  description: string
  disabled: boolean
  pending: boolean
  onRun: () => void
}) {
  const descriptionID = createUniqueId()

  return (
    <>
      <span id={descriptionID} class="sr-only">
        {props.description}
      </span>
      <TooltipV2 value={props.description} placement="bottom">
        <span
          data-component="session-compaction-control"
          class="inline-flex"
          role="group"
          aria-disabled={props.disabled}
          aria-describedby={descriptionID}
          tabIndex={props.disabled ? 0 : undefined}
        >
          <ButtonV2
            type="button"
            size="small"
            variant={props.pending ? "loading" : "neutral"}
            icon={props.pending ? undefined : "collapse"}
            disabled={props.disabled}
            tabIndex={props.disabled ? -1 : undefined}
            aria-busy={props.pending}
            aria-describedby={descriptionID}
            onClick={props.onRun}
          >
            <Show when={props.pending}>
              <Spinner class="size-3.5" />
            </Show>
            {props.label}
          </ButtonV2>
        </span>
      </TooltipV2>
    </>
  )
}

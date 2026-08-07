import { Show, type Component } from "solid-js"
import type { ModelDiscoveryPresentation } from "./model-discovery-presentation"

export const ModelDiscoveryStatus: Component<{
  presentation?: ModelDiscoveryPresentation
  message: string
  onPoliteElement: (element: HTMLDivElement) => void
  onErrorElement: (element: HTMLDivElement) => void
}> = (props) => {
  const polite = () => (props.presentation?.tone === "error" ? undefined : props.presentation)
  const error = () => (props.presentation?.tone === "error" ? props.presentation : undefined)

  return (
    <>
      <div
        ref={props.onPoliteElement}
        class="model-profile-discovery-status"
        data-active={polite() ? "" : undefined}
        data-tone={polite()?.tone}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Show when={polite()}>{props.message}</Show>
      </div>
      <div
        ref={props.onErrorElement}
        class="model-profile-discovery-status"
        data-active={error() ? "" : undefined}
        data-tone="error"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <Show when={error()}>{props.message}</Show>
      </div>
    </>
  )
}

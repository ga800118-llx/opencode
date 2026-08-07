import "../../../src/index.css"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { ModelDiscoveryPresentation } from "@/components/settings-v2/model-discovery-presentation"
import { ModelDiscoveryStatus } from "@/components/settings-v2/model-discovery-status"

const [presentation, setPresentation] = createSignal<ModelDiscoveryPresentation>()
const [message, setMessage] = createSignal("")

const fixture = {
  show(next: ModelDiscoveryPresentation, text: string) {
    setMessage(text)
    setPresentation(next)
  },
  clear() {
    setPresentation(undefined)
    setMessage("")
  },
}

declare global {
  interface Window {
    modelDiscoveryStatusFixture: typeof fixture
  }
}

window.modelDiscoveryStatusFixture = fixture

render(
  () => (
    <ModelDiscoveryStatus
      presentation={presentation()}
      message={message()}
      onPoliteElement={() => undefined}
      onErrorElement={() => undefined}
    />
  ),
  document.getElementById("root")!,
)

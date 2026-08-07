import "../../../src/index.css"
import { render } from "solid-js/web"
import { PromptInputV2AddMenu } from "@opencode-ai/session-ui/v2/prompt-input"
import { createPromptInputV2Copy } from "@/components/prompt-input-v2-copy"
import { dict as zh } from "@/i18n/zh"

const copy = createPromptInputV2Copy((key) => zh[key])

render(
  () => (
    <PromptInputV2AddMenu
      title={copy.addTitle}
      attachLabel={copy.attach}
      commandsLabel={copy.commands}
      contextLabel={copy.context}
      shellLabel={copy.shell}
      onAttach={() => undefined}
      onCommands={() => undefined}
      onContext={() => undefined}
      onShell={() => undefined}
    />
  ),
  document.getElementById("root")!,
)

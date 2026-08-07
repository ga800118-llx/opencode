import "../../../src/index.css"
import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { PromptInputV2, type PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import { createPromptInputV2Copy } from "@/components/prompt-input-v2-copy"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"

function LocalizedPromptInputFixture() {
  const [locale, setLocale] = createSignal<"en" | "zh">("en")
  const store = createStore<PromptInputV2PersistedState>({
    prompt: [
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "fixture-attachment",
        filename: "notes.txt",
        mime: "text/plain",
        dataUrl: "data:text/plain;base64,bm90ZXM=",
      },
    ],
    cursor: 0,
    context: {
      items: [
        {
          type: "file",
          key: "fixture-context",
          path: "src/example.ts",
          comment: "Review this context",
        },
      ],
    },
  })
  const controller = createPromptInputV2Controller({
    store,
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    view: {
      add: { onAttach: () => undefined },
      submit: {
        stopping: () => false,
        onSubmit: () => undefined,
        onStop: () => undefined,
      },
    },
  })
  const copy = createMemo(() => createPromptInputV2Copy((key) => (locale() === "zh" ? zh[key] : en[key])))

  return (
    <main class="mx-auto flex w-[min(720px,calc(100vw-32px))] flex-col gap-4 pt-40">
      <div class="flex gap-2">
        <button type="button" onClick={() => setLocale("en")}>
          English
        </button>
        <button type="button" onClick={() => setLocale("zh")}>
          简体中文
        </button>
        <button type="button" onClick={() => controller.openShell()}>
          Shell 模式
        </button>
      </div>
      <PromptInputV2 controller={controller} copy={copy()} />
    </main>
  )
}

render(() => <LocalizedPromptInputFixture />, document.getElementById("root")!)

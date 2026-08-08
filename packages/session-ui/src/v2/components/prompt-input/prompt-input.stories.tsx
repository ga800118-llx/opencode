// @ts-nocheck
import { createStore } from "solid-js/store"
import { PromptInputV2, type PromptInputV2PersistedState, type PromptInputV2Suggestion } from "."
import { createPromptInputV2Controller } from "./interaction"
import { createPromptInputV2Store } from "./store"
import { createEffect } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"

const agents = [
  { id: "build", label: "Build" },
  { id: "plan", label: "Plan" },
  { id: "review", label: "Review" },
]

const variants = [
  { id: "default", label: "Default" },
  { id: "fast", label: "Fast" },
  { id: "thinking", label: "Thinking" },
]

const models = [
  { id: "claude-sonnet", name: "Claude Sonnet", providerID: "anthropic" },
  { id: "gpt-5", name: "GPT-5", providerID: "openai" },
  { id: "gemini-pro", name: "Gemini Pro", providerID: "google" },
]

const contextSuggestions: PromptInputV2Suggestion[] = [
  {
    id: "file-prompt",
    kind: "file",
    label: "prompt-input-v2.tsx",
    path: "src/components/prompt-input-v2.tsx",
    recent: true,
    mention: {
      type: "file",
      path: "src/components/prompt-input-v2.tsx",
      content: "@src/components/prompt-input-v2.tsx",
      start: 0,
      end: 0,
    },
  },
  {
    id: "file-story",
    kind: "file",
    label: "prompt-input-v2.stories.tsx",
    path: "src/components/prompt-input-v2.stories.tsx",
    mention: {
      type: "file",
      path: "src/components/prompt-input-v2.stories.tsx",
      content: "@src/components/prompt-input-v2.stories.tsx",
      start: 0,
      end: 0,
    },
  },
  {
    id: "agent-review",
    kind: "agent",
    label: "@review",
    description: "Ask the review agent",
    mention: { type: "agent", name: "review", content: "@review", start: 0, end: 0 },
  },
  {
    id: "reference-docs",
    kind: "reference",
    label: "@UI guidelines",
    path: "docs/ui.md",
    description: "Project reference",
    mention: {
      type: "file",
      path: "docs/ui.md",
      content: "@UI guidelines",
      start: 0,
      end: 0,
      mime: "application/x-directory",
      filename: "UI guidelines",
    },
  },
]

const commandSuggestions: PromptInputV2Suggestion[] = [
  {
    id: "command-fix",
    kind: "command",
    label: "/fix",
    trigger: "fix",
    title: "Fix",
    description: "Fix the current issue",
    keybind: ["Enter"],
  },
  {
    id: "command-review",
    kind: "command",
    label: "/review",
    trigger: "review",
    title: "Review",
    description: "Review pending changes",
  },
  {
    id: "command-test",
    kind: "command",
    label: "/test",
    trigger: "test",
    title: "Test",
    description: "Run relevant tests",
  },
]

function PermissionModeStoryControl(props: { defaultOpen?: boolean }) {
  return (
    <MenuV2 gutter={6} modal={false} placement="top-start" defaultOpen={props.defaultOpen}>
      <MenuV2.Trigger as={ButtonV2} variant="ghost-muted" class="max-w-[148px] justify-start">
        <Icon name="shield" />
        <span class="truncate whitespace-nowrap">Standard</span>
        <Icon name="chevron-down" />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content style={{ width: "min(320px, calc(100vw - 24px))", "min-width": "0" }}>
          <MenuV2.RadioGroup value="standard">
            <MenuV2.RadioItem value="restricted" style={{ height: "auto", "min-height": "48px" }}>
              <span class="flex min-w-0 flex-col gap-1">
                <span class="whitespace-nowrap">Restricted</span>
                <span class="text-[11px] leading-4 text-v2-text-text-muted">
                  Ask before edits, commands, and outside access.
                </span>
              </span>
            </MenuV2.RadioItem>
            <MenuV2.RadioItem value="standard" style={{ height: "auto", "min-height": "48px" }}>
              <span class="flex min-w-0 flex-col gap-1">
                <span class="whitespace-nowrap">Standard</span>
                <span class="text-[11px] leading-4 text-v2-text-text-muted">
                  Use the project's configured permissions.
                </span>
              </span>
            </MenuV2.RadioItem>
            <MenuV2.RadioItem value="auto" style={{ height: "auto", "min-height": "48px" }}>
              <span class="flex min-w-0 flex-col gap-1 text-v2-state-fg-warning">
                <span class="whitespace-nowrap">Auto approve</span>
                <span class="text-[11px] leading-4 text-v2-text-text-muted">
                  Automatically approve permission requests.
                </span>
              </span>
            </MenuV2.RadioItem>
          </MenuV2.RadioGroup>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function ControlledPromptInput(props: { width: number; permissionMenuOpen?: boolean }) {
  // Agent choice is a persisted user/workspace preference in v1, not part of PromptStore.
  const [preferences, setPreferences] = createStore({ agent: "build" })

  const [runtime, setRuntime] = createStore({
    stopping: false,
  })

  // This matches the v1 PromptStore and can use the same persistence boundary.
  const state = createStore<PromptInputV2PersistedState>({
    prompt: [
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "attachment-1",
        filename: "requirements.md",
        mime: "text/markdown",
        dataUrl: "data:text/markdown;base64,IyBSZXF1aXJlbWVudHM=",
      },
    ],
    cursor: 0,
    model: { providerID: "anthropic", modelID: "claude-sonnet", variant: null },
    context: {
      items: [
        {
          key: "file:src/components/prompt-input-v2.tsx:1:40",
          type: "file",
          path: "src/components/prompt-input-v2.tsx",
          selection: { startLine: 1, startChar: 0, endLine: 40, endChar: 0 },
          comment: "Keep this component context-free",
        },
      ],
    },
  })
  const store = createPromptInputV2Store(state)

  const controller = createPromptInputV2Controller({
    store: state,
    commands: () => commandSuggestions,
    context: () => contextSuggestions,
    searchContextFiles: (query) => {
      const needle = query.trim().toLowerCase()
      return contextSuggestions.filter(
        (item) => item.kind === "file" && `${item.label} ${item.path ?? ""}`.toLowerCase().includes(needle),
      )
    },
    view: {
      add: {
        onAttach: () => addAttachment("architecture.txt", "text/plain"),
      },
      agent: {
        options: () => agents,
        current: () => preferences.agent,
        onSelect: (agent) => setPreferences("agent", agent),
      },
      model: {
        options: () => models.map((model) => ({ id: model.id, label: model.name, providerID: model.providerID })),
        current: () =>
          models.find(
            (model) => model.id === store.state.model?.modelID && model.providerID === store.state.model?.providerID,
          )?.id ?? "",
        onSelect(id) {
          const model = models.find((item) => item.id === id)
          if (!model) return
          store.setModel({
            providerID: model.providerID,
            modelID: model.id,
            variant: store.state.model?.variant,
          })
        },
      },
      variant: {
        options: () => variants,
        current: () => store.state.model?.variant ?? "default",
        onSelect: (variant) => store.setVariant(variant === "default" ? null : variant),
      },
      submit: {
        stopping: () => runtime.stopping,
        working: () => runtime.stopping,
        onSubmit: () => {
          store.reset()
          setRuntime("stopping", true)
        },
        onStop: () => setRuntime("stopping", false),
      },
      onDrop: (event) => addAttachment(event.dataTransfer?.files[0]?.name ?? "dropped-file.txt", "text/plain"),
    },
  })

  const addAttachment = (filename: string, mime: string) => {
    store.addAttachment({
      type: "image",
      id: `attachment-${store.state.prompt.filter((part) => part.type === "image").length + 1}`,
      filename,
      mime,
      dataUrl: `data:${mime};base64,`,
    })
  }

  return (
    <div class="mx-auto flex max-w-full flex-col gap-4 pt-32" style={{ width: `${props.width}px` }}>
      <PromptInputV2
        controller={controller}
        footerControl={<PermissionModeStoryControl defaultOpen={props.permissionMenuOpen} />}
      />
    </div>
  )
}

export default {
  title: "Session UI/PromptInputV2",
  id: "session-ui-prompt-input-v2",
  component: PromptInputV2,
}

export const ControlledComposition = {
  render: () => <ControlledPromptInput width={760} />,
}

export const StandardDesktop = {
  render: () => <ControlledPromptInput width={760} />,
}

export const OpenMenuMobile = {
  render: () => <ControlledPromptInput width={390} permissionMenuOpen />,
  parameters: { viewport: { defaultViewport: "mobile1" } },
}

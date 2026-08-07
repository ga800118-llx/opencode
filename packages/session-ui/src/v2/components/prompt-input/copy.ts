export type PromptInputV2Copy = {
  emptyResults: string
  commandsSearchLabel: string
  dropFiles: string
  removeAttachment: string
  removeContext: string
  promptLabel: string
  shellPromptLabel: string
  addTitle: string
  attach: string
  commands: string
  context: string
  shell: string
  chooseAgent: string
  chooseModel: string
  chooseVariant: string
  send: string
  stop: string
}

const DEFAULT_COPY: PromptInputV2Copy = {
  emptyResults: "No matching items",
  commandsSearchLabel: "Commands",
  dropFiles: "Drop files to attach",
  removeAttachment: "Remove attachment",
  removeContext: "Remove context",
  promptLabel: "Prompt",
  shellPromptLabel: "Shell command",
  addTitle: "Add images and files",
  attach: "Images and files",
  commands: "Commands",
  context: "Context",
  shell: "Shell command",
  chooseAgent: "Choose agent",
  chooseModel: "Choose model",
  chooseVariant: "Choose model variant",
  send: "Send",
  stop: "Stop",
}

export function resolvePromptInputV2Copy(copy?: Partial<PromptInputV2Copy>): PromptInputV2Copy {
  const value = (key: keyof PromptInputV2Copy) => {
    const candidate = copy?.[key]
    if (typeof candidate === "string") return candidate
    return DEFAULT_COPY[key]
  }

  return {
    emptyResults: value("emptyResults"),
    commandsSearchLabel: value("commandsSearchLabel"),
    dropFiles: value("dropFiles"),
    removeAttachment: value("removeAttachment"),
    removeContext: value("removeContext"),
    promptLabel: value("promptLabel"),
    shellPromptLabel: value("shellPromptLabel"),
    addTitle: value("addTitle"),
    attach: value("attach"),
    commands: value("commands"),
    context: value("context"),
    shell: value("shell"),
    chooseAgent: value("chooseAgent"),
    chooseModel: value("chooseModel"),
    chooseVariant: value("chooseVariant"),
    send: value("send"),
    stop: value("stop"),
  }
}

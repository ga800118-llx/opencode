import type { PromptInputV2Copy } from "@opencode-ai/session-ui/v2/prompt-input"
import { dict as en } from "@/i18n/en"

export function createPromptInputV2Copy(t: (key: keyof typeof en) => string): PromptInputV2Copy {
  return {
    emptyResults: t("prompt.popover.emptyResults"),
    commandsSearchLabel: t("prompt.menu.commands"),
    dropFiles: t("prompt.dropzone.label"),
    removeAttachment: t("prompt.attachment.remove"),
    promptLabel: t("prompt.mode.normal"),
    addTitle: t("prompt.menu.addImagesAndFiles"),
    attach: t("prompt.menu.imagesAndFiles"),
    commands: t("prompt.menu.commands"),
    context: t("prompt.menu.context"),
    shell: t("prompt.menu.shellCommand"),
    chooseAgent: t("command.agent.cycle"),
    chooseModel: t("command.model.choose"),
    chooseVariant: t("command.model.variant.cycle"),
    send: t("prompt.action.send"),
    stop: t("prompt.action.stop"),
  }
}

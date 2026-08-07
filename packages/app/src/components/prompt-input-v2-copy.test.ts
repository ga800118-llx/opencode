import { expect, test } from "bun:test"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { dict as zht } from "@/i18n/zht"
import { createPromptInputV2Copy } from "./prompt-input-v2-copy"

test("maps the complete English prompt input copy", () => {
  expect(createPromptInputV2Copy((key) => en[key])).toEqual({
    emptyResults: "No matching results",
    commandsSearchLabel: "Commands",
    dropFiles: "Drop images, PDFs, or text files here",
    removeAttachment: "Remove attachment",
    removeContext: "Remove file from context",
    promptLabel: "Prompt",
    shellPromptLabel: "Shell command",
    addTitle: "Add files and more",
    attach: "Images and files",
    commands: "Commands",
    context: "Context",
    shell: "Shell command",
    chooseAgent: "Cycle agent",
    chooseModel: "Choose model",
    chooseVariant: "Cycle thinking effort",
    send: "Send",
    stop: "Stop",
  })
})

test("maps the complete Simplified Chinese prompt input copy", () => {
  const copy = createPromptInputV2Copy((key) => zh[key])
  expect(copy).toEqual({
    emptyResults: "没有匹配的结果",
    commandsSearchLabel: "命令",
    dropFiles: "将图片、PDF 或文本文件拖放到此处",
    removeAttachment: "移除附件",
    removeContext: "从上下文移除文件",
    promptLabel: "提示词",
    shellPromptLabel: "Shell 命令",
    addTitle: "添加文件及更多内容",
    attach: "图片和文件",
    commands: "命令",
    context: "上下文",
    shell: "Shell 命令",
    chooseAgent: "切换智能体",
    chooseModel: "选择模型",
    chooseVariant: "切换思考强度",
    send: "发送",
    stop: "停止",
  })
})

test("localizes normal mode commands while preserving the Shell product term", () => {
  expect(zh["command.prompt.mode.normal"]).toBe("提示词")
  expect(zht["command.prompt.mode.normal"]).toBe("提示詞")
  expect(zh["command.prompt.mode.shell"]).toBe("Shell")
  expect(zht["command.prompt.mode.shell"]).toBe("Shell")
})

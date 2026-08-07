import { expect, test } from "bun:test"
import { dict as zh } from "@/i18n/zh"
import { createPromptInputV2Copy } from "./prompt-input-v2-copy"

test("maps the complete Simplified Chinese prompt input copy", () => {
  const copy = createPromptInputV2Copy((key) => zh[key])
  expect(copy).toEqual({
    emptyResults: "没有匹配的结果",
    commandsSearchLabel: "命令",
    dropFiles: "将图片、PDF 或文本文件拖放到此处",
    removeAttachment: "移除附件",
    promptLabel: "提示词",
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

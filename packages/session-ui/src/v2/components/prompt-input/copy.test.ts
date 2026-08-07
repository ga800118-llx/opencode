import { describe, expect, test } from "bun:test"
import { resolvePromptInputV2AttachmentCopy, resolvePromptInputV2Copy } from "./copy"

describe("resolvePromptInputV2AttachmentCopy", () => {
  test("uses the legacy remove label for both controls", () => {
    expect(resolvePromptInputV2AttachmentCopy({ removeLabel: "Remove item" })).toEqual({
      removeAttachmentLabel: "Remove item",
      removeContextLabel: "Remove item",
    })
  })

  test("keeps split attachment and context labels", () => {
    expect(
      resolvePromptInputV2AttachmentCopy({
        removeAttachmentLabel: "Remove attachment",
        removeContextLabel: "Remove context",
      }),
    ).toEqual({
      removeAttachmentLabel: "Remove attachment",
      removeContextLabel: "Remove context",
    })
  })
})

describe("resolvePromptInputV2Copy", () => {
  test("falls back when a partial copy explicitly contains undefined", () => {
    expect(resolvePromptInputV2Copy({ send: undefined, shellPromptLabel: undefined })).toMatchObject({
      send: "Send",
      shellPromptLabel: "Shell command",
    })
  })

  test("applies defined partial overrides", () => {
    expect(resolvePromptInputV2Copy({ send: "Submit", removeContext: "Remove review context" })).toMatchObject({
      send: "Submit",
      removeContext: "Remove review context",
    })
  })

  test("does not mutate partial copy or leak resolved mutations", () => {
    const partial = { send: "Submit" }
    const first = resolvePromptInputV2Copy(partial)
    first.send = "Changed"

    expect(partial).toEqual({ send: "Submit" })
    expect(resolvePromptInputV2Copy(partial).send).toBe("Submit")
    expect(resolvePromptInputV2Copy().send).toBe("Send")
  })
})

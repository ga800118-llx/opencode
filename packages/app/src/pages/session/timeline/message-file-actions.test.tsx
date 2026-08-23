import { describe, expect, test } from "bun:test"
import { createMessageFileActionController, messageFileMenuPosition } from "./message-file-actions"

function linkTarget(href: string) {
  const markdown = document.createElement("div")
  markdown.dataset.component = "markdown"
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.textContent = "file"
  markdown.appendChild(anchor)
  document.body.appendChild(markdown)
  return anchor
}

function inlinePathTarget(path: string) {
  const markdown = document.createElement("div")
  markdown.dataset.component = "markdown"
  const code = document.createElement("code")
  code.dataset.inlineCodeKind = "path"
  code.textContent = path
  markdown.appendChild(code)
  document.body.appendChild(markdown)
  return code
}

function mouseEvent(type: string, element: Element) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "target", { value: element })
  return event
}

describe("message file actions", () => {
  test("translates pointer coordinates into the menu trigger containing block", () => {
    expect(messageFileMenuPosition({ x: 500, y: 400 }, { left: 120, top: 36 })).toEqual({ x: 380, y: 364 })
    expect(messageFileMenuPosition({ x: 500, y: 400 })).toEqual({ x: 500, y: 400 })
  })

  test("opens a workspace file internally and leaves an HTTPS link untouched", () => {
    const opened: string[] = []
    const controller = createMessageFileActionController({
      directory: () => "/project",
      local: () => true,
      openInternal: (path) => opened.push(path),
    })
    const fileEvent = mouseEvent("click", linkTarget("output/report.pdf"))
    const webEvent = mouseEvent("click", linkTarget("https://example.com/report.pdf"))

    expect(controller.click(fileEvent)).toBe(true)
    expect(fileEvent.defaultPrevented).toBe(true)
    expect(opened).toEqual(["output/report.pdf"])
    expect(controller.click(webEvent)).toBe(false)
    expect(webEvent.defaultPrevented).toBe(false)
  })

  test("opens a rendered inline path internally", () => {
    const opened: string[] = []
    const controller = createMessageFileActionController({
      directory: () => "/project",
      local: () => true,
      openInternal: (path) => opened.push(path),
    })
    const event = mouseEvent("click", inlinePathTarget("软件开发注意事项.md"))

    expect(controller.click(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(opened).toEqual(["软件开发注意事项.md"])
  })

  test("blocks an escaping path without opening it", () => {
    const opened: string[] = []
    const invalid: string[] = []
    const controller = createMessageFileActionController({
      directory: () => "/project",
      local: () => true,
      openInternal: (path) => opened.push(path),
      onInvalid: (path) => invalid.push(path),
    })
    const event = mouseEvent("click", linkTarget("../secret.txt"))

    expect(controller.click(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(opened).toEqual([])
    expect(invalid).toEqual(["../secret.txt"])
  })

  test("opens a local file with the default app on double click", async () => {
    const opened: Array<[string, string | undefined]> = []
    const controller = createMessageFileActionController({
      directory: () => "/project",
      local: () => true,
      openInternal: () => undefined,
      openPath: async (path, app) => {
        opened.push([path, app])
      },
    })
    const event = mouseEvent("dblclick", linkTarget("output/report.pdf"))

    expect(controller.doubleClick(event)).toBe(true)
    await Promise.resolve()
    expect(event.defaultPrevented).toBe(true)
    expect(opened).toEqual([["/project/output/report.pdf", undefined]])
  })

  test("does not pass remote paths to the local operating system", async () => {
    const opened: string[] = []
    const controller = createMessageFileActionController({
      directory: () => "/remote/project",
      local: () => false,
      openInternal: () => undefined,
      openPath: async (path) => {
        opened.push(path)
      },
    })
    const event = mouseEvent("dblclick", linkTarget("output/report.pdf"))

    expect(controller.doubleClick(event)).toBe(true)
    await Promise.resolve()
    expect(opened).toEqual([])
  })

  test("reveals, copies, and opens with a selected app", async () => {
    const calls: string[] = []
    const controller = createMessageFileActionController({
      directory: () => "C:\\project",
      local: () => true,
      openInternal: () => undefined,
      openPath: async (path, app) => {
        calls.push(`open:${path}:${app ?? "default"}`)
      },
      revealPath: async (path) => {
        calls.push(`reveal:${path}`)
        return true
      },
      copyPath: async (path) => {
        calls.push(`copy:${path}`)
      },
    })
    const reference = controller.context(mouseEvent("contextmenu", inlinePathTarget("output\\report.docx")))
    expect(reference?.absolutePath).toBe("C:\\project\\output\\report.docx")

    await controller.openWith(reference!, "code")
    await controller.reveal(reference!)
    await controller.copy(reference!)

    expect(calls).toEqual([
      "open:C:\\project\\output\\report.docx:code",
      "reveal:C:\\project\\output\\report.docx",
      "copy:C:\\project\\output\\report.docx",
    ])
  })

  test("reports a missing file when reveal returns false", async () => {
    const missing: string[] = []
    const controller = createMessageFileActionController({
      directory: () => "/project",
      local: () => true,
      openInternal: () => undefined,
      revealPath: async () => false,
      onMissing: (path) => missing.push(path),
    })
    const reference = controller.context(mouseEvent("contextmenu", linkTarget("missing.pdf")))

    await controller.reveal(reference!)
    expect(missing).toEqual(["/project/missing.pdf"])
  })

  test("sets the resolved absolute path as the hover title", () => {
    const anchor = linkTarget("folder/file-without-extension")
    const controller = createMessageFileActionController({
      directory: () => "/project",
      local: () => true,
      openInternal: () => undefined,
    })

    expect(controller.hover(mouseEvent("pointerover", anchor))).toBe(true)
    expect(anchor.title).toBe("/project/folder/file-without-extension")
    expect(anchor.dataset.messageFileReference).toBe("true")
  })
})

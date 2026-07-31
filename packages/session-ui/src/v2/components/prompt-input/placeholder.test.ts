import { expect, test } from "bun:test"

const css = await Bun.file(new URL("./attachments.css", import.meta.url)).text()
const component = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

test("keeps the empty prompt placeholder as a single CSS escape", () => {
  const rule = css.match(
    /\[data-component="prompt-input-v2"\]\s+\[data-component="prompt-input"\]:empty::before\s*\{\s*content:\s*"(?<content>[^"]+)";\s*\}/,
  )

  expect(rule?.groups?.content).toBe("\\200B")
  expect(css).not.toMatch(/^\[data-component="prompt-input"\]:empty::before/m)
  expect(component).not.toContain("empty:before:content-")
})

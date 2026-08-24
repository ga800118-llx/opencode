import { expect, test } from "bun:test"

test("file tabs render from their path without stale Show accessors", async () => {
  const sources = await Promise.all(
    ["session-sortable-tab.tsx", "session-sortable-tab-v2.tsx"].map((name) =>
      Bun.file(new URL(name, import.meta.url)).text(),
    ),
  )

  sources.forEach((source) => {
    expect(source).toContain("<Show when={path()} keyed>")
    expect(source).not.toContain("<Show when={content()}>{(value) => value()}</Show>")
  })
})

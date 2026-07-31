import { describe, expect, test } from "bun:test"

const taskCallers = [
  "../components/prompt-input/submit.ts",
  "../pages/session.tsx",
  "../pages/session/use-session-commands.tsx",
] as const

describe("product task routing", () => {
  test.each(taskCallers)("keeps task execution behind the adapter in %s", async (path) => {
    const source = await Bun.file(new URL(path, import.meta.url)).text()

    expect(source).not.toMatch(/\b(?:api\.session|session)\s*\.\s*(?:create|prompt|command|shell|interrupt)\s*\(/)
  })
})

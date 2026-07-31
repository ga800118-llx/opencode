import { describe, expect, test } from "bun:test"
import { PRODUCT_FEATURES } from "./features"

describe("PRODUCT_FEATURES", () => {
  test("preserves the Phase 0 capability baseline", () => {
    expect(PRODUCT_FEATURES).toMatchObject({
      cloudProviders: true,
      customProviders: true,
      localModels: true,
      modelSelection: true,
      modelVariants: true,
      taskHistory: true,
      streaming: true,
      toolCalling: true,
      permissions: true,
      fileBrowser: true,
      diffReview: true,
      terminal: true,
      worktrees: true,
      agentShell: true,
      separateTerminalAndAgentShell: true,
      agents: true,
      mcp: true,
      skills: true,
      commands: true,
      attachments: true,
      multipleTasks: true,
      localization: true,
      diagnostics: true,
      revertRestore: true,
      multipleServers: true,
    })
  })

  test("does not claim later product capabilities", () => {
    expect(PRODUCT_FEATURES).toMatchObject({
      visualProviderProfiles: false,
      keychainCredentials: false,
      automaticLocalModelDiscovery: false,
      taskCrashRecovery: false,
    })
  })

  test("is frozen for stable Advanced-mode mapping", () => {
    const mutable = PRODUCT_FEATURES as unknown as { agents: boolean }

    expect(Object.isFrozen(PRODUCT_FEATURES)).toBe(true)
    expect(() => {
      mutable.agents = false
    }).toThrow()
    expect(PRODUCT_FEATURES.agents).toBe(true)
  })
})

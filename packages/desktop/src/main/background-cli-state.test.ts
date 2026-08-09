import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { getProductIdentity } from "../product/identity"
import { createBackgroundCliStatePlan } from "./background-cli-state"

describe("background CLI state plan", () => {
  test("isolates development discovery and fallback to userData", () => {
    const userDataPath = join("root", "dev.agent.desktop")
    const plan = createBackgroundCliStatePlan({
      identity: getProductIdentity("dev"),
      environmentStateHome: join("root", "environment"),
      shellStateHome: join("root", "shell"),
      appDataPath: join("root", "app-data"),
      userDataPath,
      exists: () => {
        throw new Error("development planning must not scan other state homes")
      },
    })

    expect(plan.discoveryCandidates).toEqual([userDataPath])
    expect(plan.fallbackDaemonStateHome).toBe(userDataPath)
    expect(plan.discoveryCandidates.some((candidate) => candidate?.includes("ai.opencode.desktop"))).toBe(false)
  })

  test("uses onboarding userData for development isolation", () => {
    const userDataPath = join("tmp", "onboarding", "desktop")
    const plan = createBackgroundCliStatePlan({
      identity: getProductIdentity("dev"),
      environmentStateHome: join("tmp", "onboarding", "state"),
      shellStateHome: join("root", "shell"),
      appDataPath: join("root", "app-data"),
      userDataPath,
      exists: () => false,
    })

    expect(plan.discoveryCandidates).toEqual([userDataPath])
    expect(plan.fallbackDaemonStateHome).toBe(userDataPath)
  })

  test("keeps beta state isolated from development and upstream products", () => {
    const identity = getProductIdentity("beta")
    const environmentStateHome = join("root", "beta-state")
    const shellStateHome = join("root", "shell")
    const plan = createBackgroundCliStatePlan({
      identity,
      environmentStateHome,
      shellStateHome,
      appDataPath: join("root", "app-data"),
      userDataPath: join("root", "app-data", identity.dataNamespace),
      exists: () => true,
    })

    expect(plan.discoveryCandidates).toEqual([environmentStateHome, shellStateHome])
    expect(plan.fallbackDaemonStateHome).toBe(environmentStateHome)
  })

  test("preserves production migration order, deduplication, and filtering", () => {
    const identity = getProductIdentity("prod")
    const appDataPath = join("root", "app-data")
    const compatible = identity.compatibleDataNamespaces.map((namespace) => join(appDataPath, namespace))
    const environmentStateHome = compatible[0]
    const shellStateHome = join("root", "shell")
    const existing = new Set([environmentStateHome, shellStateHome, compatible[1]])
    const plan = createBackgroundCliStatePlan({
      identity,
      environmentStateHome,
      shellStateHome,
      appDataPath,
      userDataPath: join(appDataPath, identity.dataNamespace),
      exists: (path) => existing.has(path),
    })

    expect(plan.discoveryCandidates).toEqual([environmentStateHome, shellStateHome, compatible[1]])
    expect(plan.fallbackDaemonStateHome).toBe(environmentStateHome)
  })
})

import { expect, test } from "bun:test"
import type { SidecarListener } from "./server"
import { createSidecarEnv } from "./sidecar-environment"

test("SidecarListener exposes typed process completion", async () => {
  let stops = 0
  const listener: SidecarListener = {
    exit: Promise.resolve(17),
    async stop() {
      stops += 1
    },
  }

  expect(await listener.exit).toBe(17)
  await listener.stop()
  expect(stops).toBe(1)
})

test("createSidecarEnv merges explicit child values without mutating the parent", () => {
  const parent = { PATH: "/bin", DEBUG: "private-debug", LD_PRELOAD: "linux-only" }
  const child = createSidecarEnv(
    { AGENT_PROFILE_ONE_API_KEY: "sk-test-secret" },
    parent,
    "linux",
  )

  expect(child).toEqual({ PATH: "/bin", AGENT_PROFILE_ONE_API_KEY: "sk-test-secret" })
  expect(parent).toEqual({ PATH: "/bin", DEBUG: "private-debug", LD_PRELOAD: "linux-only" })
})

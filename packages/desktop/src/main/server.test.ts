import { expect, test } from "bun:test"
import type { SidecarListener } from "./server"

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

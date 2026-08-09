import { describe, expect, test } from "bun:test"
import { getProductIdentity, type ProductChannel } from "./identity"
import { createDesktopProductPresentation, preserveDesktopWindowTitle } from "./presentation"

const names = {
  dev: "Guai Code Dev",
  beta: "Guai Code Beta",
  prod: "Guai Code",
} satisfies Record<ProductChannel, string>

describe("desktop product presentation", () => {
  for (const channel of ["dev", "beta", "prod"] as const) {
    test(`uses the ${channel} product name for native and recovery titles`, () => {
      const presentation = createDesktopProductPresentation(getProductIdentity(channel).name)
      const titles: string[] = []
      let prevented = false

      preserveDesktopWindowTitle(
        presentation,
        {
          preventDefault() {
            prevented = true
          },
        },
        {
          setTitle(title) {
            titles.push(title)
          },
        },
      )

      expect(presentation).toEqual({
        name: names[channel],
        recovery: {
          loadFailed: `${names[channel]} failed to load`,
          processGone: `${names[channel]} window terminated unexpectedly`,
          unresponsive: `${names[channel]} is not responding`,
        },
      })
      expect(prevented).toBe(true)
      expect(titles).toEqual([names[channel]])
    })
  }
})

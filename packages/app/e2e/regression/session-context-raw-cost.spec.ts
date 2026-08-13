import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

test.use({ viewport: { width: 1440, height: 900 } })

test("omits assistant cost from expanded context raw messages", async ({ page }) => {
  const message = assistantMessage([
    toolPart(
      "prt_business_cost",
      "quote",
      "completed",
      { cost: "estimated-business-value" },
      { metadata: { cost: "actual-business-value" } },
    ),
  ])
  await setupTimeline(page, { messages: [userMessage(), message] })
  await page.getByRole("button", { name: "View context usage", exact: true }).click()

  const assistant = page.locator('[data-slot="accordion-item"]').filter({ hasText: "assistant" }).first()
  await assistant.locator('[data-slot="accordion-trigger"]').click()
  const content = assistant.locator('[data-slot="accordion-content"]')
  await expect(content).toContainText('"role": "assistant"')
  await expect(content).toContainText('"cost": "estimated-business-value"')
  await expect(content).toContainText('"cost": "actual-business-value"')
  await expect(content).not.toContainText("$0.01")
  await expect(content).not.toContainText('"cost": 0.01')
  expect(message.info.cost).toBe(0.01)
})

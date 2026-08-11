import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  messageUpdated,
  setupTimeline,
} from "../performance/timeline-stability/fixture"
import { fulfillJson, isolateAppStorage } from "../utils/mac-stability"

test.use({ viewport: { width: 1440, height: 900 } })

test("hides cost and sends one exact compaction request before refreshing usage", async ({ page }) => {
  await isolateAppStorage(page)
  const timeline = await setupTimeline(page, { settings: { newLayoutDesigns: true } })
  const requests: Array<{ pathname: string; directory: string | null; body: unknown }> = []
  const response = Promise.withResolvers<void>()

  await page.route("**/session/*/summarize**", async (route) => {
    const url = new URL(route.request().url())
    requests.push({
      pathname: url.pathname,
      directory: url.searchParams.get("directory"),
      body: route.request().postDataJSON(),
    })
    await response.promise
    await fulfillJson(route, true)
  })

  const contextUsage = page.getByRole("button", { name: "View context usage", exact: true })
  await expect(contextUsage).toBeVisible()
  await contextUsage.hover()
  await expect(page.getByText("Cost", { exact: true })).toHaveCount(0)
  await expect(page.getByText("$0.01", { exact: true })).toHaveCount(0)

  await contextUsage.click()
  await expect(page.getByText("Total Cost", { exact: true })).toHaveCount(0)
  const totalTokens = page.getByText("Total Tokens", { exact: true }).locator("..")
  await expect(totalTokens).toContainText("300")

  const compact = page.getByRole("button", { name: "Compact session", exact: true })
  await expect(compact).toBeEnabled()
  await compact.evaluate((button) => {
    ;(button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })
  await expect.poll(() => requests.length).toBe(1)
  await expect(compact).toBeDisabled()
  expect(requests).toEqual([
    {
      pathname: "/session/ses_timeline_stability/summarize",
      directory: null,
      body: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
  ])

  response.resolve()
  const next = assistantMessage()
  next.info.tokens = { input: 400, output: 500, reasoning: 0, cache: { read: 0, write: 0 } }
  await timeline.send(messageUpdated(next.info))

  await expect(totalTokens).toContainText("900")
  await expect(compact).toBeEnabled()
})

import { expect, test, type Page } from "@playwright/test"
import type { ModelDiscoveryPresentation } from "../../src/components/settings-v2/model-discovery-presentation"

type FixtureAPI = {
  show: (presentation: ModelDiscoveryPresentation, message: string) => void
  clear: () => void
}

const show = (page: Page, presentation: ModelDiscoveryPresentation, message: string) =>
  page.evaluate(
    ({ next, text }) =>
      (window as unknown as { modelDiscoveryStatusFixture: FixtureAPI }).modelDiscoveryStatusFixture.show(next, text),
    { next: presentation, text: message },
  )

const clear = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { modelDiscoveryStatusFixture: FixtureAPI }).modelDiscoveryStatusFixture.clear(),
  )

test("keeps stable polite and assertive regions while discovery feedback changes", async ({ page }) => {
  await page.goto("/e2e/fixtures/model-discovery-status/")

  const status = page.getByRole("status")
  const alert = page.getByRole("alert")
  await expect(status).toHaveCount(1)
  await expect(alert).toHaveCount(1)
  await expect(status).toHaveText("")
  await expect(alert).toHaveText("")
  await status.evaluate((element) => ((window as unknown as { initialStatus: Element }).initialStatus = element))
  await alert.evaluate((element) => ((window as unknown as { initialAlert: Element }).initialAlert = element))

  await show(
    page,
    { key: "settings.modelCenter.discovery.progress", live: "polite", tone: "progress" },
    "Discovering models",
  )
  await expect(status).toHaveAttribute("aria-live", "polite")
  await expect(status).toHaveAttribute("data-active", "")
  await expect(status).toHaveText("Discovering models")
  await expect(alert).not.toHaveAttribute("data-active", "")
  await expect(alert).toHaveText("")

  await show(
    page,
    { key: "settings.modelCenter.discovery.invalidEndpoint", live: "assertive", tone: "error" },
    "Enter a complete endpoint",
  )
  await expect(status).not.toHaveAttribute("data-active", "")
  await expect(status).toHaveText("")
  await expect(alert).toHaveAttribute("aria-live", "assertive")
  await expect(alert).toHaveAttribute("data-active", "")
  await expect(alert).toHaveText("Enter a complete endpoint")

  expect(
    await status.evaluate((element) => element === (window as unknown as { initialStatus: Element }).initialStatus),
  ).toBe(true)
  expect(
    await alert.evaluate((element) => element === (window as unknown as { initialAlert: Element }).initialAlert),
  ).toBe(true)

  await clear(page)
  await expect(status).toHaveText("")
  await expect(alert).toHaveText("")
})

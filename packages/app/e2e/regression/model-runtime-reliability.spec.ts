import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  reasoningPart,
  setupTimeline,
  userMessage,
} from "../performance/timeline-stability/fixture"
import { expectAppVisible } from "../utils/waits"
import { isolateAppStorage, setupMockApp } from "../utils/mac-stability"

test.use({ viewport: { width: 1440, height: 900 } })

test("removes the user-configurable model runtime timeout field", async ({ page }) => {
  const directory = "C:/OpenCode/ModelRuntimeSettings"
  await setupMockApp(page, { directory })
  await page.goto("/")

  const settings = page.getByRole("button", { name: "Settings", exact: true }).first()
  await expectAppVisible(settings)
  await settings.click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("button", { name: "Private endpoint", exact: true }).click()

  const profile = page.locator(".model-profile-dialog")
  await expect(profile).toBeVisible()
  await expect(profile.getByText("Name", { exact: true })).toBeVisible()
  await expect(profile.getByText("Endpoint URL", { exact: true })).toBeVisible()
  await expect(profile.getByText("API key", { exact: true })).toBeVisible()
  await expect(profile.getByLabel(/timeout/i)).toHaveCount(0)
  await expect(profile.getByText(/^timeout$/i)).toHaveCount(0)
})

test("keeps a delayed model request running beyond the former short deadline", async ({ page }) => {
  await isolateAppStorage(page)
  const timeline = await setupTimeline(page, { settings: { newLayoutDesigns: true } })
  const started = Promise.withResolvers<void>()
  const response = Promise.withResolvers<void>()
  const failures: string[] = []
  let requests = 0

  page.on("requestfailed", (request) => {
    if (request.url().includes("/prompt_async")) failures.push(request.failure()?.errorText ?? "unknown")
  })
  await page.route("**/session/*/prompt_async**", async (route) => {
    requests++
    started.resolve()
    await response.promise
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    })
  })

  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expectAppVisible(composer)
  await input.fill("Keep this deterministic request running")
  await composer.locator('[data-action="prompt-submit"]').click()
  await started.promise

  try {
    await expect(composer.locator('[data-action="prompt-submit"]')).toHaveAccessibleName("Stop")
    await page.waitForTimeout(1_250)
    expect(requests).toBe(1)
    expect(failures).toEqual([])
    await expect(composer.locator('[data-action="prompt-submit"]')).toHaveAccessibleName("Stop")
  } finally {
    response.resolve()
  }

  await timeline.transport.send({
    directory: "C:/OpenCode/TimelineStability",
    payload: {
      id: "evt_model_runtime_idle",
      type: "session.status",
      properties: { sessionID: "ses_timeline_stability", status: { type: "idle" } },
    },
  })
})

test("projects slow and unverified activity without stopping the task", async ({ page }) => {
  const now = Date.now()
  await page.clock.install({ time: now })
  await isolateAppStorage(page)
  await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    messages: [
      userMessage(undefined, { created: now - 2_000 }),
      assistantMessage([reasoningPart("prt_runtime_reasoning", "Checking ongoing activity")], {
        completed: false,
        created: now - 1_000,
      }),
    ],
  })

  const process = page.locator('[data-slot="session-turn-thinking"]')
  const label = process
  await expect(process).toBeVisible()
  await expect(label).not.toContainText("Response is slow")

  await page.clock.fastForward(3 * 60_000 + 1_000)
  await expect(label).toContainText("Response is slow; still waiting")
  await expect(page.locator('[data-action="prompt-submit"]')).toHaveAccessibleName("Stop")

  await page.clock.fastForward(7 * 60_000)
  await expect(label).toContainText("Activity cannot be confirmed; task is still running")
  await expect(page.locator('[data-action="prompt-submit"]')).toHaveAccessibleName("Stop")
  await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0)
})

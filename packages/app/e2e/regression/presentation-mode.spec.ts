import { expect, test, type Locator, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/PresentationMode"

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_presentation_mode",
      worktree: directory,
      vcs: "git",
      name: "presentation-mode",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/pty/shells", (route) => route.fulfill({ json: [] }))
})

test("changes and persists the presentation mode without reloading", async ({ page }) => {
  await seedSettings(page, "simple")
  const state = await openSettings(page)
  await expect(state.trigger).toHaveAccessibleName("Simple")

  await selectMode(page, state.trigger, "Advanced")

  await expectModeState(page, state, "Advanced", "advanced")
})

test("restores advanced mode and persists simple without reloading", async ({ page }) => {
  await seedSettings(page, "advanced")
  const state = await openSettings(page)
  await expect(state.trigger).toHaveAccessibleName("Advanced")

  await selectMode(page, state.trigger, "Simple")

  await expectModeState(page, state, "Simple", "simple")
})

async function seedSettings(page: Page, presentationMode: "simple" | "advanced") {
  await page.addInitScript((mode) => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          newLayoutDesigns: true,
          presentationMode: mode,
          autoSave: false,
        },
      }),
    )
  }, presentationMode)
}

async function openSettings(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible()

  const navigations: string[] = []
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })
  const url = page.url()

  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  const mode = dialog.locator('[data-action="settings-presentation-mode"]')
  await expect(mode).toHaveAccessibleName("Interface mode")
  return { dialog, trigger: mode.getByRole("button"), navigations, url }
}

async function selectMode(page: Page, trigger: Locator, label: "Simple" | "Advanced") {
  await trigger.press("Enter")
  const option = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${label}$`) })
  await expect(option).toBeVisible()
  await option.press("Enter")
}

async function expectModeState(
  page: Page,
  state: Awaited<ReturnType<typeof openSettings>>,
  label: "Simple" | "Advanced",
  presentationMode: "simple" | "advanced",
) {
  await expect(state.trigger).toHaveAccessibleName(label)
  await expect(state.dialog).toBeVisible()
  await expect(page).toHaveURL(state.url)
  expect(state.navigations).toEqual([])
  await expect
    .poll(() =>
      page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}") as {
          general?: { presentationMode?: string; autoSave?: boolean }
        }
        return {
          presentationMode: settings.general?.presentationMode,
          autoSave: settings.general?.autoSave,
        }
      }),
    )
    .toEqual({ presentationMode, autoSave: false })
}

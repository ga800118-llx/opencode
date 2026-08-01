import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/PresentationMode"

test("changes and persists the presentation mode without reloading", async ({ page }) => {
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
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          newLayoutDesigns: true,
          presentationMode: "simple",
          autoSave: false,
        },
      }),
    )
  })

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
  const trigger = mode.getByRole("button")
  await expect(trigger).toHaveAccessibleName("Simple")

  await trigger.press("Enter")
  const advanced = page.locator('[role="option"]').filter({ hasText: /^Advanced$/ })
  await expect(advanced).toBeVisible()
  await advanced.press("Enter")

  await expect(trigger).toHaveAccessibleName("Advanced")
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(url)
  expect(navigations).toEqual([])
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
    .toEqual({ presentationMode: "advanced", autoSave: false })
})

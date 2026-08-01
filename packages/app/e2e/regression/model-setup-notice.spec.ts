import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const draftID = "draft_model_setup_notice"
const directory = "C:/OpenCode/ModelSetupNotice"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 720, height: 800 } })

test("shows responsive model guidance and opens the available settings route", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_setup_notice",
      worktree: directory,
      vcs: "git",
      name: "model-setup-notice",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )

  await page.goto(`/new-session?draftId=${draftID}`)

  const tabsInfo = page.getByRole("button", { name: "Dismiss Tabs information" })
  if (await tabsInfo.isVisible()) await tabsInfo.click()
  const notice = page.locator('[data-component="model-setup-notice"]')
  await expect(notice).toBeVisible()
  await expect(notice.getByRole("button", { name: "Manage providers" })).toHaveCount(1)
  await expect(page.locator('[data-component="provider-tip"]')).toHaveCount(0)
  expect(
    await notice.evaluate((element) => ({
      fitsViewport: element.getBoundingClientRect().right <= window.innerWidth,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
      textWraps: getComputedStyle(element.querySelector("p")!).whiteSpace === "normal",
      textMinWidth: getComputedStyle(element.querySelector("p")!).minWidth,
    })),
  ).toEqual({ fitsViewport: true, noHorizontalOverflow: true, textWraps: true, textMinWidth: "0px" })

  await notice.getByRole("button", { name: "Manage providers" }).click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true")
})

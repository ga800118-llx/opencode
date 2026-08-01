import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const draftID = "draft_model_setup_notice"
const directory = "C:/OpenCode/ModelSetupNotice"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 720, height: 800 } })

test("keeps model guidance stable from setup fallback to a connected built-in model", async ({ page }) => {
  let provider: unknown = { all: [], connected: [], default: {} }
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
    provider: () => provider,
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
  const slot = page.locator('[data-component="model-setup-notice-slot"]')
  const notice = page.locator('[data-component="model-setup-notice"]')
  await expect(slot).toHaveAttribute("data-readiness", "desktop-unavailable")
  await expect(notice).toBeVisible()
  await expect(notice.getByRole("button", { name: "Manage models" })).toHaveCount(1)
  await expect(page.locator('[data-component="provider-tip"]')).toHaveCount(0)
  const visibleGeometry = await slot.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      top: Math.round(rect.top * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
      previousBottom: Math.round(element.previousElementSibling!.getBoundingClientRect().bottom * 10) / 10,
      nextTop: Math.round(element.nextElementSibling!.getBoundingClientRect().top * 10) / 10,
    }
  })
  expect(visibleGeometry.height).toBe(68)
  expect(
    await notice.evaluate((element) => {
      const noticeRect = element.getBoundingClientRect()
      const slotRect = element.parentElement!.getBoundingClientRect()
      return {
        contained: noticeRect.top >= slotRect.top && noticeRect.bottom <= slotRect.bottom,
        fitsViewport: noticeRect.right <= window.innerWidth,
        noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
        noVerticalOverflow: element.scrollHeight <= element.clientHeight,
        textWraps: getComputedStyle(element.querySelector("p")!).whiteSpace === "normal",
        textMinWidth: getComputedStyle(element.querySelector("p")!).minWidth,
      }
    }),
  ).toEqual({
    contained: true,
    fitsViewport: true,
    noHorizontalOverflow: true,
    noVerticalOverflow: true,
    textWraps: true,
    textMinWidth: "0px",
  })

  await notice.getByRole("button", { name: "Manage models" }).click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true")

  provider = {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { test: { id: "test", name: "Built-in Test", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "test" },
  }
  await page.reload()

  await expect(slot).toHaveAttribute("data-readiness", "ready")
  await expect(notice).toHaveCount(0)
  await expect(page.locator('[data-component="provider-tip"]')).toBeVisible()
  expect(
    await slot.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        top: Math.round(rect.top * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        previousBottom: Math.round(element.previousElementSibling!.getBoundingClientRect().bottom * 10) / 10,
        nextTop: Math.round(element.nextElementSibling!.getBoundingClientRect().top * 10) / 10,
      }
    }),
  ).toEqual(visibleGeometry)
  expect(
    await slot.evaluate((element) => ({
      fitsViewport: element.getBoundingClientRect().right <= window.innerWidth,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
    })),
  ).toEqual({ fitsViewport: true, noHorizontalOverflow: true })
})

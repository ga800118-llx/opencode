import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport, type SseTransport } from "../utils/sse-transport"

const draftID = "draft_model_setup_notice"
const directory = "C:/OpenCode/ModelSetupNotice"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const viewports = [
  { width: 360, height: 800, slotHeight: 104 },
  { width: 720, height: 800, slotHeight: 68 },
  { width: 1024, height: 800, slotHeight: 44 },
] as const

const emptyProvider = { all: [], connected: [], default: {} }
const connectedProvider = {
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

async function geometry(page: Page) {
  return page.locator('[data-component="model-setup-notice-slot"]').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const round = (value: number) => Math.round(value * 10) / 10
    return {
      top: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
      previousBottom: round(element.previousElementSibling!.getBoundingClientRect().bottom),
      nextTop: round(element.nextElementSibling!.getBoundingClientRect().top),
    }
  })
}

async function expectSlotFits(page: Page, height: number) {
  const slot = page.locator('[data-component="model-setup-notice-slot"]')
  expect((await geometry(page)).height).toBe(height)
  expect(
    await slot.evaluate((element) => {
      const notice = element.querySelector<HTMLElement>('[data-component="model-setup-notice"]')
      const slotRect = element.getBoundingClientRect()
      const noticeRect = notice?.getBoundingClientRect()
      return {
        fitsViewport: slotRect.left >= 0 && slotRect.right <= window.innerWidth,
        noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
        noVerticalOverflow: element.scrollHeight <= element.clientHeight,
        noticeContained:
          !noticeRect ||
          (noticeRect.left >= slotRect.left &&
            noticeRect.right <= slotRect.right &&
            noticeRect.top >= slotRect.top &&
            noticeRect.bottom <= slotRect.bottom),
        noticeNoHorizontalOverflow: !notice || notice.scrollWidth <= notice.clientWidth,
        noticeNoVerticalOverflow: !notice || notice.scrollHeight <= notice.clientHeight,
      }
    }),
  ).toEqual({
    fitsViewport: true,
    noHorizontalOverflow: true,
    noVerticalOverflow: true,
    noticeContained: true,
    noticeNoHorizontalOverflow: true,
    noticeNoVerticalOverflow: true,
  })
}

async function refreshProviders(transport: SseTransport<Record<string, unknown>>) {
  const connection = (await transport.connections()).findLast((item) => item.endedAt === undefined)!
  const event = { id: `evt_provider_refresh_${connection.id}`, type: "global.disposed", properties: {} }
  await transport.send(
    connection.path === "/event"
      ? event
      : {
          directory: "global",
          payload: event,
        },
  )
}

for (const viewport of viewports) {
  test(`keeps model guidance stable and reactive at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    let provider: unknown = emptyProvider
    const transport = await installSseTransport<Record<string, unknown>>(page, { server, retry: 20 })
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
    await transport.waitForConnection()

    const tabsInfo = page.getByRole("button", { name: "Dismiss Tabs information" })
    if (await tabsInfo.isVisible()) await tabsInfo.click()
    const slot = page.locator('[data-component="model-setup-notice-slot"]')
    const notice = page.locator('[data-component="model-setup-notice"]')
    await expect(slot).toHaveAttribute("data-readiness", "desktop-unavailable")
    await expect(notice).toBeVisible()
    await expect(notice.getByRole("button", { name: "Manage models" })).toHaveCount(1)
    await expect(page.locator('[data-component="provider-tip"]')).toHaveCount(0)
    const visibleGeometry = await geometry(page)
    await expectSlotFits(page, viewport.slotHeight)

    if (viewport.width === 720) {
      await notice.getByRole("button", { name: "Manage models" }).dblclick()
      const dialog = page.locator(".settings-v2-dialog")
      await expect(dialog).toHaveCount(1)
      await expect(dialog.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true")
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
    }

    await page.waitForTimeout(1_600)
    provider = connectedProvider
    await refreshProviders(transport)

    await expect(slot).toHaveAttribute("data-readiness", "ready")
    await expect(notice).toHaveCount(0)
    await expect(page.locator('[data-component="provider-tip"]')).toBeVisible()
    expect(await geometry(page)).toEqual(visibleGeometry)
    await expectSlotFits(page, viewport.slotHeight)
  })
}

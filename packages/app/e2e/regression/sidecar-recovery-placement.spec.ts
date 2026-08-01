import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/SidecarRecoveryPlacement"

for (const newLayoutDesigns of [true, false]) {
  test(`places one zero-layout recovery mount below ${newLayoutDesigns ? "new" : "legacy"} chrome`, async ({
    page,
  }) => {
    await page.addInitScript((enabled) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: enabled } }))
    }, newLayoutDesigns)
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: `proj_sidecar_recovery_${newLayoutDesigns ? "new" : "legacy"}`,
        worktree: directory,
        vcs: "git",
        name: "sidecar-recovery-placement",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: { all: [], connected: [], default: {} },
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })

    await page.goto("/")

    const titlebar = page.locator("header[data-tauri-drag-region]")
    const mount = page.locator('[data-component="sidecar-recovery-mount"]')
    const route = page.locator("main").first()
    await expect(titlebar).toBeVisible()
    await expect(mount).toHaveCount(1)
    await expect(page.locator('[data-component="sidecar-recovery-notice"]')).toHaveCount(0)
    await expect(route).toBeVisible()

    expect(
      await mount.evaluate((element) => {
        const titlebar = document.querySelector("header[data-tauri-drag-region]")!
        const route = document.querySelector("main")!
        const rect = element.getBoundingClientRect()
        const next = element.nextElementSibling!.getBoundingClientRect()
        const titlebarRect = titlebar.getBoundingClientRect()
        return {
          display: getComputedStyle(element).display,
          sameParent: titlebar.parentElement === element.parentElement,
          immediatelyAfterTitlebar: titlebar.nextElementSibling === element,
          titlebarBeforeMount: !!(titlebar.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
          mountBeforeRoute: !!(element.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING),
          zeroRect: rect.width === 0 && rect.height === 0,
          zeroGap: Math.abs(next.top - titlebarRect.bottom) < 1,
        }
      }),
    ).toEqual({
      display: "contents",
      sameParent: true,
      immediatelyAfterTitlebar: true,
      titlebarBeforeMount: true,
      mountBeforeRoute: true,
      zeroRect: true,
      zeroGap: true,
    })

    const handle = await mount.elementHandle()
    await page.evaluate(() => {
      history.pushState({}, "", "/?recovery-placement=navigated")
      dispatchEvent(new PopStateEvent("popstate"))
    })
    await expect(page).toHaveURL(/recovery-placement=navigated/)
    await expect(mount).toHaveCount(1)
    expect(await handle!.evaluate((element) => element.isConnected)).toBe(true)
  })
}

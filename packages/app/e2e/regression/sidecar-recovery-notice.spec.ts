import { expect, test, type Page } from "@playwright/test"

type FixtureStatus = {
  state: "ready" | "starting" | "failed"
  changedAt: number
  error?: { kind: "start" | "health" | "exit" }
}

type FixtureAPI = {
  emit: (status: FixtureStatus) => void
  resolveRestart: (status: FixtureStatus) => void
  rejectRestart: () => void
  resolveDiagnostics: () => void
  rejectDiagnostics: () => void
  snapshot: () => {
    getStatusCalls: number
    subscribeCalls: number
    restartCalls: number
    diagnosticsCalls: number
  }
}

const fixture = (page: Page) =>
  page.evaluate(() => (window as unknown as { sidecarRecoveryFixture: FixtureAPI }).sidecarRecoveryFixture.snapshot())

const emit = (page: Page, status: FixtureStatus) =>
  page.evaluate(
    (next) => (window as unknown as { sidecarRecoveryFixture: FixtureAPI }).sidecarRecoveryFixture.emit(next),
    status,
  )

test.use({ viewport: { width: 720, height: 800 } })

test("renders one recoverable sidecar notice without overlap, overflow, or raw errors", async ({ page }) => {
  await page.goto("/e2e/fixtures/sidecar-recovery/")

  const shell = page.locator('[data-component="recovery-shell"]')
  const content = page.getByTestId("route-content")
  const notice = page.locator('[data-component="sidecar-recovery-notice"]')
  await expect(shell).toHaveCount(1)
  await expect(notice).toHaveCount(0)
  expect(await fixture(page)).toEqual({ getStatusCalls: 1, subscribeCalls: 1, restartCalls: 0, diagnosticsCalls: 0 })
  expect((await content.boundingBox())?.y).toBe((await shell.boundingBox())?.y)

  await emit(page, { state: "starting", changedAt: Date.now() })
  await expect(notice).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(notice).toHaveCount(0)
  const progress = page.getByRole("status")
  await expect(progress).toBeVisible({ timeout: 2_500 })
  await expect(progress).toHaveAttribute("aria-live", "polite")
  await expect(notice).toHaveCount(1)
  expect((await content.boundingBox())!.y).toBeGreaterThan((await shell.boundingBox())!.y)

  await emit(page, { state: "failed", changedAt: Date.now(), error: { kind: "exit" } })
  const failure = page.getByRole("alert")
  await expect(failure).toBeVisible()
  await expect(notice).toHaveCount(1)
  const restart = notice.locator('[data-action="restart-agent-service"]')
  const diagnostics = notice.locator('[data-action="export-agent-diagnostics"]')
  await expect(page.getByRole("button", { name: "Restart service" })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Export diagnostics" })).toHaveCount(1)
  await expect(restart).toBeVisible()
  await expect(diagnostics).toBeVisible()

  const geometry = await notice.evaluate((element) => {
    const text = element.querySelector("p")!
    const restart = element.querySelector<HTMLElement>('[data-action="restart-agent-service"]')!
    return {
      noticeFits: element.getBoundingClientRect().right <= window.innerWidth,
      noticeNoOverflow: element.scrollWidth <= element.clientWidth,
      textNoOverflow: text.scrollWidth <= text.clientWidth,
      actionsWrapped: restart.getBoundingClientRect().top >= text.getBoundingClientRect().bottom,
    }
  })
  expect(geometry).toEqual({
    noticeFits: true,
    noticeNoOverflow: true,
    textNoOverflow: true,
    actionsWrapped: true,
  })

  await restart.click()
  await expect(restart).toBeDisabled()
  await expect(restart).toHaveAttribute("aria-busy", "true")
  await restart.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  expect((await fixture(page)).restartCalls).toBe(1)
  await page.evaluate(() =>
    (window as unknown as { sidecarRecoveryFixture: FixtureAPI }).sidecarRecoveryFixture.rejectRestart(),
  )
  await expect(page.getByRole("button", { name: "Retry restart" })).toBeEnabled()
  await page.getByRole("button", { name: "Retry restart" }).click()
  expect((await fixture(page)).restartCalls).toBe(2)
  await page.evaluate(() =>
    (window as unknown as { sidecarRecoveryFixture: FixtureAPI }).sidecarRecoveryFixture.resolveRestart({
      state: "ready",
      changedAt: Date.now(),
    }),
  )
  await expect(notice).toHaveCount(0)
  expect((await content.boundingBox())?.y).toBe((await shell.boundingBox())?.y)

  await emit(page, { state: "failed", changedAt: Date.now(), error: { kind: "health" } })
  await diagnostics.click()
  await expect(diagnostics).toBeDisabled()
  await expect(diagnostics).toHaveAttribute("aria-busy", "true")
  await diagnostics.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  expect((await fixture(page)).diagnosticsCalls).toBe(1)
  await page.evaluate(() =>
    (window as unknown as { sidecarRecoveryFixture: FixtureAPI }).sidecarRecoveryFixture.rejectDiagnostics(),
  )
  await expect(page.getByRole("button", { name: "Retry export" })).toBeEnabled()
  await page.getByRole("button", { name: "Retry export" }).click()
  expect((await fixture(page)).diagnosticsCalls).toBe(2)
  await page.evaluate(() =>
    (window as unknown as { sidecarRecoveryFixture: FixtureAPI }).sidecarRecoveryFixture.resolveDiagnostics(),
  )
  await expect(page.getByRole("button", { name: "Export diagnostics" })).toBeEnabled()

  const rendered = await page.locator("body").innerText()
  expect(rendered).not.toContain("fixture-secret-error")
  expect(rendered).not.toContain("/Users/private")
  expect(rendered).not.toContain("agent-debug.zip")
})

test("omits diagnostics when the platform exporter is unavailable", async ({ page }) => {
  await page.goto("/e2e/fixtures/sidecar-recovery/?diagnostics=0")
  await emit(page, { state: "failed", changedAt: Date.now(), error: { kind: "start" } })

  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.getByRole("button", { name: "Restart service" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export diagnostics" })).toHaveCount(0)
  await expect(page.locator('[data-component="sidecar-recovery-notice"]')).toHaveCount(1)
})

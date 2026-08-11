import { expect, test, type Page } from "@playwright/test"
import { expectAppVisible } from "../utils/waits"
import {
  fulfillJson,
  persistedDraftTabs,
  projectFixture,
  setupMockApp,
} from "../utils/mac-stability"

const directory = "C:/OpenCode/ImmediateTask"
const project = projectFixture(directory, { id: "proj_immediate_task", name: "ImmediateTask", color: "green" })

test.use({ viewport: { width: 1440, height: 900 } })

test("adds a project and deduplicates an immediate double New Task click", async ({ page }) => {
  await setup(page)
  const gate = Promise.withResolvers<void>()
  const bootstrapRequests: string[] = []
  await page.route("**/config**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== "/config") return route.fallback()
    bootstrapRequests.push(`${page.url()} -> ${url.pathname}${url.search}`)
    await gate.promise
    await fulfillJson(route, {})
  })

  await page.goto("/")
  const row = await addProject(page)
  const newTask = row.locator("..").locator('[data-action="home-project-new-session"]')
  await newTask.evaluate((button) => {
    ;(button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })

  await expect.poll(() => bootstrapRequests.length).toBe(1)
  await expect(newTask).toHaveAttribute("aria-busy", "true")
  expect(await persistedDraftTabs(page)).toHaveLength(0)
  gate.resolve()

  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
  expect(bootstrapRequests, `workspace bootstrap requests:\n${bootstrapRequests.join("\n")}`).toHaveLength(1)
  expect(await persistedDraftTabs(page)).toHaveLength(1)
})

test("allows New Task to retry after the first critical bootstrap failure", async ({ page }) => {
  await setup(page)
  let bootstrapCalls = 0
  await page.route("**/config**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/config") return route.fallback()
    bootstrapCalls++
    if (bootstrapCalls === 1) return fulfillJson(route, { error: "critical config unavailable" }, 500)
    return fulfillJson(route, {})
  })

  await page.goto("/")
  const row = await addProject(page)
  const newTask = row.locator("..").locator('[data-action="home-project-new-session"]')
  await newTask.click()

  await expect.poll(() => bootstrapCalls).toBe(1)
  await expect(newTask).toBeEnabled()
  await expect(page).toHaveURL(/\/$/)
  expect(await persistedDraftTabs(page)).toHaveLength(0)
  await expect(page.getByText("Failed to reload ImmediateTask", { exact: true })).toBeVisible()

  await newTask.click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
  expect(bootstrapCalls).toBe(2)
  expect(await persistedDraftTabs(page)).toHaveLength(1)
})

async function setup(page: Page) {
  await setupMockApp(page, {
    directory,
    project,
    projects: [],
    fileList: (path) =>
      path ? [] : [{ name: project.name, path: project.name, absolute: directory, type: "directory", ignored: false }],
    findFiles: () => [project.name],
  })
}

async function addProject(page: Page) {
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  const option = page.locator("[data-directory-path]")
  await expect(option).toHaveCount(1)
  await option.click()
  const row = page.locator('[data-component="home-project-row"]').filter({ hasText: project.name }).first()
  await expect(row).toBeVisible()
  await row.hover()
  return row
}

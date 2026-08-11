import { expect, test } from "@playwright/test"
import { expectAppVisible } from "../utils/waits"
import { fulfillJson, projectFixture, setupMockApp } from "../utils/mac-stability"

const directory = "C:/OpenCode/ProjectMetadataPersistence"
const projectID = "proj_project_metadata_persistence"
const originalName = "ProjectMetadataPersistence"
const updatedName = "Persistent Purple Project"

test.use({ viewport: { width: 1440, height: 900 } })

test("persists an edited project name and color across a full page remount", async ({ page }) => {
  const project = projectFixture(directory, { id: projectID, name: originalName, color: "gray" })
  await setupMockApp(page, { directory, project })
  const patches: unknown[] = []
  await page.route(`**/project/${projectID}**`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    const patch = route.request().postDataJSON()
    patches.push(patch)
    await fulfillJson(route, {
      ...project,
      ...patch,
      icon: { ...project.icon, ...(patch as { icon?: object }).icon },
    })
  })

  await page.goto("/")
  const row = page.locator('[data-component="home-project-row"]').filter({ hasText: originalName }).first()
  await expectAppVisible(row)
  await row.hover()
  await row.locator("..").getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Edit project", exact: true }).click()

  const dialog = page
    .locator(".settings-v2-dialog, [data-component=dialog-v2]")
    .filter({ hasText: "Edit project" })
    .last()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Name", { exact: true }).fill(updatedName)
  await dialog.getByRole("button", { name: "Select purple color", exact: true }).click()
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Edit project" })).toHaveCount(0)

  expect(patches).toHaveLength(1)
  const updatedRow = page.locator('[data-component="home-project-row"]').filter({ hasText: updatedName }).first()
  await expect(updatedRow).toBeVisible()
  await expect(updatedRow.locator('[data-slot="project-avatar-surface"]')).toHaveAttribute("data-variant", "purple")

  const persisted = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.endsWith(":workspace:project"))
      .map(([key, value]) => ({ key, value: JSON.parse(value) })),
  )
  expect(persisted).toHaveLength(1)
  expect(JSON.stringify(persisted[0])).toContain(updatedName)
  expect(JSON.stringify(persisted[0])).toContain('"purple"')

  await page.reload()
  const remounted = page.locator('[data-component="home-project-row"]').filter({ hasText: updatedName }).first()
  await expectAppVisible(remounted)
  await expect(remounted.locator('[data-slot="project-avatar-surface"]')).toHaveAttribute("data-variant", "purple")
  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: originalName })).toHaveCount(0)
})

test("keeps failed project edits in the open dialog and retries without local mutation", async ({ page }) => {
  const project = projectFixture(directory, { id: projectID, name: originalName, color: "gray" })
  await setupMockApp(page, { directory, project })
  const patches: Array<{ name?: string; icon?: { color?: string } }> = []
  await page.route(`**/project/${projectID}**`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    const patch = route.request().postDataJSON() as { name?: string; icon?: { color?: string } }
    patches.push(patch)
    if (patches.length === 1) return fulfillJson(route, { message: "Fixture rejected the project update" }, 500)
    return fulfillJson(route, {
      ...project,
      ...patch,
      icon: { ...project.icon, ...patch.icon },
    })
  })

  await page.goto("/")
  const row = page.locator('[data-component="home-project-row"]').filter({ hasText: originalName }).first()
  await expectAppVisible(row)
  const before = await persistedProjectMetadata(page)
  await row.hover()
  await row.locator("..").getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Edit project", exact: true }).click()

  const dialog = page
    .locator(".settings-v2-dialog, [data-component=dialog-v2]")
    .filter({ hasText: "Edit project" })
    .last()
  const name = dialog.getByLabel("Name", { exact: true })
  const purple = dialog.getByRole("button", { name: "Select purple color", exact: true })
  await name.fill(updatedName)
  await purple.click()
  await dialog.getByRole("button", { name: "Save", exact: true }).click()

  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue(updatedName)
  await expect(purple).toHaveAttribute("aria-pressed", "true")
  await expect(dialog.getByRole("alert")).toBeVisible()
  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: originalName })).toBeVisible()
  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: updatedName })).toHaveCount(0)
  expect(await persistedProjectMetadata(page)).toEqual(before)
  expect(patches).toHaveLength(1)

  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(patches).toHaveLength(2)
  expect(patches[1]).toEqual(patches[0])
  const updatedRow = page.locator('[data-component="home-project-row"]').filter({ hasText: updatedName }).first()
  await expect(updatedRow).toBeVisible()
  await expect(updatedRow.locator('[data-slot="project-avatar-surface"]')).toHaveAttribute("data-variant", "purple")
  expect(JSON.stringify(await persistedProjectMetadata(page))).toContain(updatedName)
  expect(JSON.stringify(await persistedProjectMetadata(page))).toContain('"purple"')
})

function persistedProjectMetadata(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.endsWith(":workspace:project"))
      .map(([key, value]) => ({ key, value: JSON.parse(value) })),
  )
}

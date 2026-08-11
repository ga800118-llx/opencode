import { expect, test } from "@playwright/test"
import { expectAppVisible } from "../utils/waits"
import { fulfillJson, projectFixture, setupMockApp } from "../utils/mac-stability"

const directory = "C:/OpenCode/SkillRefresh"

const existing = {
  id: "project-existing",
  name: "existing-skill",
  description: "Already installed",
  location: `${directory}/.opencode/skills/existing/SKILL.md`,
  source: { type: "directory", scope: "project", value: `${directory}/.opencode/skills` },
  status: "active",
  enabled: true,
  deletable: true,
  deleteTarget: `${directory}/.opencode/skills/existing`,
}

const installed = {
  ...existing,
  id: "project-newly-installed",
  name: "newly-installed-skill",
  description: "Installed while settings remain open",
  location: `${directory}/.opencode/skills/newly-installed/SKILL.md`,
  deleteTarget: `${directory}/.opencode/skills/newly-installed`,
}

test.use({ viewport: { width: 1440, height: 900 } })

test("discovers an externally installed Skill on polling and retains it after refresh failure", async ({ page }) => {
  const project = projectFixture(directory, { id: "proj_skill_refresh", name: "SkillRefresh", color: "blue" })
  await setupMockApp(page, { directory, project })
  let calls = 0
  await page.route("**/api/skill/management**", async (route) => {
    calls++
    if (calls >= 3) return fulfillJson(route, { error: "deterministic refresh failure" }, 500)
    const items = calls === 1 ? [existing] : [existing, installed]
    await fulfillJson(route, {
      location: { directory, project: { id: project.id, directory } },
      data: items,
    })
  })

  await page.goto("/")
  const settings = page.getByRole("button", { name: "Settings", exact: true }).first()
  await expectAppVisible(settings)
  await settings.click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Skills", exact: true }).click()

  await expect(dialog.getByText(existing.name, { exact: true })).toBeVisible()
  await expect(dialog.getByText(installed.name, { exact: true })).toBeVisible({ timeout: 7_000 })
  await expect.poll(() => calls, { timeout: 7_000 }).toBeGreaterThanOrEqual(3)
  await expect(dialog.getByRole("alert")).toContainText(
    "Skills could not be refreshed. Showing the last successful results.",
  )
  await expect(dialog.getByText(existing.name, { exact: true })).toBeVisible()
  await expect(dialog.getByText(installed.name, { exact: true })).toBeVisible()
})

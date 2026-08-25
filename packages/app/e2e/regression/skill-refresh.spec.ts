import { base64Encode } from "@opencode-ai/core/util/encode"
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

const refreshed = {
  ...existing,
  id: "project-manually-refreshed",
  name: "manually-refreshed-skill",
  description: "Discovered by a full manual refresh",
  location: `${directory}/.opencode/skills/manually-refreshed/SKILL.md`,
  deleteTarget: `${directory}/.opencode/skills/manually-refreshed`,
}

const session = {
  id: "ses_skill_refresh",
  slug: "skill-refresh",
  projectID: "proj_skill_refresh",
  directory,
  title: "Skill refresh session",
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

test.use({ viewport: { width: 1440, height: 900 } })

test("discovers an externally installed Skill on polling and retains it after refresh failure", async ({ page }) => {
  const project = projectFixture(directory, { id: "proj_skill_refresh", name: "SkillRefresh", color: "blue" })
  await setupMockApp(page, { directory, project })
  let pollCalls = 0
  let failedPolls = 0
  const manualRequests: string[] = []
  await page.route("**/api/skill/management**", async (route) => {
    const url = new URL(route.request().url())
    if (
      route.request().method() !== "GET" ||
      url.pathname !== "/api/skill/management" ||
      url.searchParams.get("location[directory]") !== directory
    )
      return route.fallback()
    if (url.searchParams.get("refresh") === "true") {
      manualRequests.push(url.toString())
      return fulfillJson(route, {
        location: { directory, project: { id: project.id, directory } },
        data: [existing, installed, refreshed],
      })
    }

    pollCalls++
    if (pollCalls >= 3) {
      failedPolls++
      return fulfillJson(route, { error: "deterministic refresh failure" }, 500)
    }
    const items = pollCalls === 1 ? [existing] : [existing, installed]
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
  const refresh = dialog.getByRole("button", { name: "Refresh Skills", exact: true })
  await expect(refresh).toBeEnabled()
  await refresh.click()
  await expect.poll(() => manualRequests.length).toBe(1)
  expect(new URL(manualRequests[0]!).searchParams.get("refresh")).toBe("true")
  await expect(dialog.getByText(refreshed.name, { exact: true })).toBeVisible()

  const failuresBeforeStaleCheck = failedPolls
  await expect.poll(() => failedPolls, { timeout: 7_000 }).toBeGreaterThan(failuresBeforeStaleCheck)
  await expect(dialog.getByRole("alert")).toContainText(
    "Skills could not be refreshed. Showing the last successful results.",
  )
  await expect(dialog.getByText(existing.name, { exact: true })).toBeVisible()
  await expect(dialog.getByText(installed.name, { exact: true })).toBeVisible()
  await expect(dialog.getByText(refreshed.name, { exact: true })).toBeVisible()
})

test("opens one device Skill inventory from Home", async ({ page }) => {
  const otherDirectory = "C:/OpenCode/SkillRefreshOther"
  const project = projectFixture(directory, { id: "proj_skill_refresh", name: "SkillRefresh", color: "blue" })
  const shared = {
    ...existing,
    id: "global-shared",
    name: "shared-device-skill",
    description: "Shared across device locations",
    location: "C:/Users/test/.agents/skills/shared-device-skill/SKILL.md",
    source: { type: "external", scope: "global", value: "C:/Users/test/.agents/skills" },
    deletable: false,
    deleteTarget: undefined,
  }
  const firstProject = {
    ...existing,
    id: "first-project-skill",
    name: "first-project-skill",
  }
  const secondProject = {
    ...existing,
    id: "second-project-skill",
    name: "second-project-skill",
    location: `${otherDirectory}/.opencode/skills/second/SKILL.md`,
    source: { type: "directory", scope: "project", value: `${otherDirectory}/.opencode/skills` },
    deleteTarget: `${otherDirectory}/.opencode/skills/second`,
  }
  await setupMockApp(page, {
    directory,
    project,
    projects: [
      { worktree: directory, expanded: true },
      { worktree: otherDirectory, expanded: true },
    ],
  })
  const requested = new Set<string>()
  await page.route("**/api/skill/management**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== "GET" || url.pathname !== "/api/skill/management") return route.fallback()
    const location = url.searchParams.get("location[directory]") ?? ""
    requested.add(location)
    await fulfillJson(route, {
      location: { directory: location, project: { id: project.id, directory: location } },
      data: location === otherDirectory ? [shared, secondProject] : [shared, firstProject],
    })
  })

  await page.goto("/")
  const settings = page.getByRole("button", { name: "Settings", exact: true }).first()
  await expectAppVisible(settings)
  await settings.click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Skills", exact: true }).click()

  await expect(dialog.getByText(firstProject.name, { exact: true })).toBeVisible()
  await expect(dialog.getByText(secondProject.name, { exact: true })).toBeVisible()
  await expect(dialog.getByText(shared.name, { exact: true })).toHaveCount(1)
  await expect.poll(() => [...requested]).toEqual(expect.arrayContaining([directory, otherDirectory]))
})

test("opens session Skills settings in the active project directory", async ({ page }) => {
  const project = projectFixture(directory, { id: session.projectID, name: "SkillRefresh", color: "blue" })
  await setupMockApp(page, { directory, project, sessions: [session] })
  const directories: string[] = []
  await page.route("**/api/skill/management**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== "GET" || url.pathname !== "/api/skill/management") return route.fallback()
    directories.push(url.searchParams.get("location[directory]") ?? "")
    await fulfillJson(route, {
      location: { directory, project: { id: project.id, directory } },
      data: [existing],
    })
  })

  await page.goto(`/${base64Encode(directory)}/session/${session.id}`)
  await expect(page.getByText(session.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Skills", exact: true }).click()

  await expect(dialog.getByText(existing.name, { exact: true })).toBeVisible()
  await expect.poll(() => directories).toContain(directory)
  expect(directories.every((item) => item === directory)).toBe(true)
})

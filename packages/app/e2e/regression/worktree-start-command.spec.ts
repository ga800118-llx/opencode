import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fulfillJson, mockServer, projectFixture, setupMockApp } from "../utils/mac-stability"

const directory = "C:/OpenCode/WorktreeStartCommand"
const worktree = `${directory}/workspace`
const draftID = "draft_worktree_start_command"
const sessionID = "ses_worktree_start_command"

test.use({ viewport: { width: 1440, height: 900 } })

test("sends the persisted V2 project start override when creating a workspace", async ({ page }) => {
  const project = projectFixture(directory)
  await setupMockApp(page, {
    directory,
    protocol: "v2",
    project,
    projectMeta: { commands: { start: "bun run dev" } },
  })
  const requests: unknown[] = []
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    requests.push(route.request().postDataJSON())
    await fulfillJson(route, { name: "workspace", branch: "workspace", directory: `${directory}/workspace` })
  })

  await page.goto("/")
  await page.evaluate(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: false } }))
    localStorage.setItem("app-version.v1", JSON.stringify({ version: "1.17.20" }))
  })
  await page.goto(`/${base64Encode(directory)}/session`)
  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  await page.locator('[data-action="project-menu"]:visible').click()
  await page.getByRole("menuitem", { name: "Enable workspaces" }).click()
  await page.getByRole("button", { name: "New workspace", exact: true }).click()

  await expect.poll(() => requests).toEqual([{ projectStartCommandOverride: "bun run dev" }])
})

test("sends the persisted V2 project start override from the new-task composer", async ({ page }) => {
  const project = projectFixture(directory)
  await setupMockApp(page, {
    directory,
    protocol: "v2",
    project,
    projectMeta: { commands: { start: "bun run dev" } },
    tabs: [{ type: "draft", draftID, server: mockServer, directory }],
  })
  const worktreeRequests: unknown[] = []
  const sessionRequests: unknown[] = []
  await page.route("**/experimental/worktree**", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    worktreeRequests.push(route.request().postDataJSON())
    await fulfillJson(route, { name: "workspace", branch: "workspace", directory: worktree })
  })
  await page.route("**/api/session**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === "POST" && url.pathname === "/api/session") {
      sessionRequests.push(route.request().postDataJSON())
      return fulfillJson(route, {
        data: {
          id: sessionID,
          projectID: project.id,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
          title: "New workspace task",
          location: { directory: worktree },
        },
      })
    }
    if (route.request().method() === "POST" && url.pathname === `/api/session/${sessionID}/prompt`) {
      return fulfillJson(route, {
        data: {
          admittedSeq: 1,
          id: "msg_worktree_start_command",
          sessionID,
          timeCreated: 1_700_000_000_000,
          type: "user",
          data: { text: "Run the project" },
          delivery: "steer",
        },
      })
    }
    return route.fallback()
  })

  await page.goto(`/new-session?draftId=${draftID}`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const workspaceSelector = page.locator('[data-component="new-session-workspace-details"] button').first()
  await expect(composer).toBeVisible()
  await workspaceSelector.click()
  await page.getByRole("menuitem", { name: "New workspace", exact: true }).click()
  await expect(workspaceSelector).toContainText("New workspace")

  await composer.locator('[data-component="prompt-input"]').fill("Run the project")
  await composer.locator('[data-action="prompt-submit"]').click()

  await expect.poll(() => worktreeRequests).toEqual([{ projectStartCommandOverride: "bun run dev" }])
  await expect.poll(() => sessionRequests).toEqual([expect.objectContaining({ location: { directory: worktree } })])
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
})

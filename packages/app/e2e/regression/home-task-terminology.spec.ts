import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/TaskTerminology"
const projectName = "TaskTerminology"
const sessionID = "ses_task_terminology"
const sessionTitle = "Review task terminology"

const profiles = [
  {
    locale: "en",
    tasks: "Tasks",
    newTask: "New task",
    recentTasks: "Recent tasks",
    searchTasks: "Search tasks",
    noTasks: "No tasks",
    noResults: "No tasks found for missing",
  },
  {
    locale: "zh",
    tasks: "任务",
    newTask: "新建任务",
    recentTasks: "最近任务",
    searchTasks: "搜索任务",
    noTasks: "暂无任务",
    noResults: "未找到与 missing 相关的任务",
  },
] as const

test.use({ viewport: { width: 1440, height: 900 } })

for (const profile of profiles) {
  test(`renders and opens Home tasks in ${profile.locale}`, async ({ page }) => {
    await setup(page, profile.locale, [session()])
    await page.goto("/")

    const search = page.getByRole("textbox", { name: profile.searchTasks })
    await expectAppVisible(search)
    await expect(page.getByRole("region", { name: profile.recentTasks })).toBeVisible()
    await expect(page.getByRole("button", { name: profile.newTask }).first()).toBeVisible()

    await search.fill("missing")
    await expect(page.getByText(profile.noResults, { exact: true })).toBeVisible()
    await expect(search).toHaveValue("missing")

    await search.fill(sessionTitle)
    await expect(page.getByText(profile.tasks, { exact: true })).toBeVisible()
    await page.getByRole("option", { name: new RegExp(sessionTitle) }).click()

    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  })

  test(`renders the Home empty state and creates a task in ${profile.locale}`, async ({ page }) => {
    await setup(page, profile.locale, [])
    await page.goto("/")

    const project = page.locator('[data-component="home-project-row"]').filter({ hasText: projectName }).first()
    await expectAppVisible(project)
    await project.click()

    await expect(page.getByText(profile.noTasks, { exact: true })).toBeVisible()
    const newTask = page.getByRole("button", { name: profile.newTask }).first()
    await expect(newTask).toBeVisible()
    await newTask.click()

    await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
  })
}

async function setup(page: Page, locale: (typeof profiles)[number]["locale"], sessions: ReturnType<typeof session>[]) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_task_terminology",
      worktree: directory,
      vcs: "git",
      name: projectName,
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "task-model": {
              id: "task-model",
              name: "Task Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "task-model" },
    },
    sessions,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, locale }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
    },
    { directory, locale },
  )
}

function session() {
  return {
    id: sessionID,
    slug: sessionID,
    projectID: "proj_task_terminology",
    directory,
    title: sessionTitle,
    version: "dev",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  }
}

import { expect, test, type Locator, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_new_session_presentation"
const projectRoot = "C:/OpenCode/PromptFirst"
const directory = `${projectRoot}/worktree-a`
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_new_session_presentation",
      worktree: projectRoot,
      vcs: "git",
      name: "prompt-first",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [directory],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "model-a": {
              id: "model-a",
              name: "Model A",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
            "model-b": {
              id: "model-b",
              name: "Model B",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
              variants: { high: {} },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "model-a" },
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/pty/shells", (route) => route.fulfill({ json: [] }))
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, presentationMode: "simple" } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )
})

test("keeps the prompt workflow mounted while switching from Simple to Advanced", async ({ page }) => {
  await page.goto(`/new-session?draftId=${draftID}`)

  const view = page.locator('[data-component="session-new-design"]')
  const composerSurface = page.locator('[data-component="new-session-composer"]')
  const composer = composerSurface.locator('[data-component="prompt-input-v2"]')
  const editor = composer.locator('[data-component="prompt-input"]')
  const model = composer.locator('[data-action="prompt-model"]')
  const attach = composer.locator('[data-action="prompt-attach"]')
  const submit = composer.locator('[data-action="prompt-submit"]')
  const project = page.locator('[data-component="new-session-project-controls"] [data-action="prompt-project"]')
  const workspace = page.locator('[data-component="new-session-workspace-details"]')

  await expectAppVisible(composer)
  await dismissTabsInformation(page)
  await expect(view).toHaveAttribute("data-presentation-mode", "simple")
  await expect(composerSurface).toHaveAttribute("data-presentation-priority", "primary")
  await expect(composer).toHaveCount(1)
  await expect(model).toContainText("Model A")
  await expect(attach).toBeVisible()
  await expect(submit).toBeVisible()
  await expect(project).toContainText("prompt-first")
  await expect(workspace).toContainText("worktree-a")
  await expect(workspace).toContainText("main")
  await expect(workspace).toHaveAttribute("data-presentation-priority", "secondary")
  await expect(workspace).toHaveCSS("opacity", "0.7")
  await expectFirstViewport(page, composer, workspace)

  await editor.fill("Keep this non-empty draft")
  await model.click()
  await page.locator('[data-option-key="opencode:model-b"]').click()
  await expect(model).toContainText("Model B")
  await expect(composer.getByRole("button", { name: "Choose agent" })).toBeVisible()
  await expect(composer.getByRole("button", { name: "Choose model variant" })).toBeVisible()
  await attach.click()
  await expect(page.getByRole("menuitem", { name: "Commands" })).toBeVisible()
  await page.keyboard.press("Escape")

  await markMounted(editor, "editor")
  await markMounted(model, "model")
  await markMounted(project, "project")
  await markMounted(workspace, "workspace")
  await selectAdvancedMode(page)

  await expect(view).toHaveAttribute("data-presentation-mode", "advanced")
  await expect(workspace).toHaveAttribute("data-presentation-priority", "primary")
  await expect(workspace).toHaveCSS("opacity", "1")
  await expect(composer).toHaveCount(1)
  await expect(editor).toHaveAttribute("data-mounted-identity", "editor")
  await expect(model).toHaveAttribute("data-mounted-identity", "model")
  await expect(project).toHaveAttribute("data-mounted-identity", "project")
  await expect(workspace).toHaveAttribute("data-mounted-identity", "workspace")
  await expect(editor).toHaveText("Keep this non-empty draft")
  await expect(model).toContainText("Model B")
  await expect(project).toContainText("prompt-first")
  await expect(workspace).toContainText("worktree-a")
  await expect(composer.getByRole("button", { name: "Choose agent" })).toBeVisible()
  await expect(composer.getByRole("button", { name: "Choose model variant" })).toBeVisible()
  await expect(attach).toBeVisible()
  await expect(submit).toBeEnabled()
})

async function dismissTabsInformation(page: Page) {
  const dismiss = page.getByRole("button", { name: "Dismiss Tabs information" })
  if (await dismiss.isVisible()) await dismiss.click()
}

async function expectFirstViewport(page: Page, composer: Locator, next: Locator) {
  expect(
    await page.evaluate(
      ({ composer, next }) => {
        const composerRect = document.querySelector(composer)?.getBoundingClientRect()
        const nextRect = document.querySelector(next)?.getBoundingClientRect()
        return {
          composerVisible: !!composerRect && composerRect.top >= 0 && composerRect.bottom <= innerHeight,
          nextVisible: !!nextRect && nextRect.top >= 0 && nextRect.bottom <= innerHeight,
        }
      },
      { composer: '[data-component="prompt-input-v2"]', next: '[data-component="new-session-workspace-details"]' },
    ),
  ).toEqual({ composerVisible: true, nextVisible: true })
}

async function markMounted(locator: Locator, value: string) {
  await locator.evaluate((element, identity) => element.setAttribute("data-mounted-identity", identity), value)
}

async function selectAdvancedMode(page: Page) {
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  const trigger = dialog.locator('[data-action="settings-presentation-mode"]').getByRole("button")
  await trigger.press("Enter")
  const option = page.locator('[role="option"]').filter({ hasText: /^Advanced$/ })
  await expect(option).toBeVisible()
  await option.press("Enter")
  await expect(trigger).toHaveAccessibleName("Advanced")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
}

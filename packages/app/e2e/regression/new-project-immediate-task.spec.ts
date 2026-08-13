import { expect, test, type Page } from "@playwright/test"
import { expectAppVisible } from "../utils/waits"
import {
  fulfillJson,
  mockServer,
  persistedDraftTabs,
  projectFixture,
  protocols,
  setupMockApp,
} from "../utils/mac-stability"
import { installSseTransport } from "../utils/sse-transport"

const directory = "C:/OpenCode/ImmediateTask"
const project = projectFixture(directory, { id: "proj_immediate_task", name: "ImmediateTask", color: "green" })

test.use({ viewport: { width: 1440, height: 900 } })

for (const protocol of protocols) {
  test.describe(`${protocol.toUpperCase()} project task recovery`, () => {
    test("adds a project and deduplicates an immediate double New Task click", async ({ page }) => {
      await setup(page, protocol)
      const transport = await installSseTransport(page, { server: mockServer })
      const gate = Promise.withResolvers<void>()
      const bootstrapRequests: string[] = []
      await page.route("**/config**", async (route) => {
        if (!isWorkspaceConfigRequest(route.request())) return route.fallback()
        const url = new URL(route.request().url())
        const request = `${page.url()} -> ${url.pathname}${url.search}`
        bootstrapRequests.push(request)
        if (bootstrapRequests.length === 1) await gate.promise
        await fulfillJson(route, {})
      })

      const protocolReady = waitForProtocol(page, protocol)
      await page.goto("/")
      await protocolReady
      await transport.waitForConnection()
      const row = await addProject(page, protocol)
      await page.clock.install({ time: Date.now() })
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
      expect(await persistedDraftTabs(page)).toHaveLength(1)
      expect(
        bootstrapRequests,
        `workspace bootstrap requests after double click:\n${bootstrapRequests.join("\n")}`,
      ).toHaveLength(1)

      await page.clock.fastForward(1_501)
      expect(
        bootstrapRequests,
        `workspace bootstrap requests before reconnect:\n${bootstrapRequests.join("\n")}`,
      ).toHaveLength(1)
      await transport.send({
        directory: "global",
        payload: { id: "evt_immediate_task_reconnected", type: "server.connected", properties: {} },
      })
      await expect.poll(() => bootstrapRequests.length).toBe(2)
      expect(
        bootstrapRequests,
        `workspace bootstrap requests after explicit reconnect:\n${bootstrapRequests.join("\n")}`,
      ).toHaveLength(2)
    })

    test("allows New Task to retry after the first critical bootstrap failure", async ({ page }) => {
      await setup(page, protocol)
      let readinessAttempts = 0
      let readinessComplete = false
      await page.route("**/config**", async (route) => {
        if (!isWorkspaceConfigRequest(route.request())) return route.fallback()
        if (readinessComplete) return fulfillJson(route, {})
        readinessAttempts++
        if (readinessAttempts === 1) return fulfillJson(route, { error: "critical config unavailable" }, 500)
        await fulfillJson(route, {})
        readinessComplete = true
      })

      const protocolReady = waitForProtocol(page, protocol)
      await page.goto("/")
      await protocolReady
      const row = await addProject(page, protocol)
      const newTask = row.locator("..").locator('[data-action="home-project-new-session"]')
      await newTask.click()

      await expect.poll(() => readinessAttempts).toBe(1)
      await expect(newTask).toBeEnabled()
      await expect(page).toHaveURL(/\/$/)
      expect(await persistedDraftTabs(page)).toHaveLength(0)
      await expect(page.getByText("Failed to reload ImmediateTask", { exact: true })).toBeVisible()

      await newTask.click()
      await expect(page).toHaveURL(/\/new-session\?draftId=/)
      await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
      expect(readinessAttempts).toBe(2)
      expect(await persistedDraftTabs(page)).toHaveLength(1)
    })
  })
}

async function setup(page: Page, protocol: (typeof protocols)[number]) {
  await setupMockApp(page, {
    directory,
    protocol,
    project,
    projects: [],
    fileList: (path) => {
      if (protocol === "v1")
        return path
          ? []
          : [{ name: project.name, path: project.name, absolute: directory, type: "directory", ignored: false }]
      const name = path === "C:/" ? "OpenCode" : path === "C:/OpenCode" ? project.name : undefined
      return name ? [{ name, path: name, absolute: `${path.replace(/\/$/, "")}/${name}`, type: "directory" }] : []
    },
    findFiles: () => [project.name],
  })
}

function waitForProtocol(page: Page, protocol: (typeof protocols)[number]) {
  return page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname
    return path === (protocol === "v1" ? "/global/health" : "/api/health")
  })
}

async function addProject(page: Page, protocol: (typeof protocols)[number]) {
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  if (protocol === "v2") {
    await page.getByPlaceholder("Search folders").fill(directory.replaceAll("/", "\\"))
  }
  const option = page.locator("[data-directory-path]")
  await expect(option).toHaveCount(1)
  await option.filter({ hasText: project.name }).click()
  const row = page.locator('[data-component="home-project-row"]').filter({ hasText: project.name }).first()
  await expect(row).toBeVisible()
  await row.hover()
  return row
}

function isWorkspaceConfigRequest(request: import("@playwright/test").Request) {
  const url = new URL(request.url())
  return request.method() === "GET" && url.pathname === "/config" && url.searchParams.get("directory") === directory
}

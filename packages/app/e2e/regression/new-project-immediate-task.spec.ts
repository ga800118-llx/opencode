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
      let agentRequests = 0
      const agentGate = Promise.withResolvers<void>()
      await setup(page, protocol, async (input) => {
        if (input.directory !== directory) return selectableAgents(protocol)
        agentRequests++
        if (agentRequests === 1) return []
        await agentGate.promise
        return selectableAgents(protocol)
      })
      const transport = await installSseTransport(page, { server: mockServer })
      const bootstrapRequests: string[] = []
      await page.route("**/config**", async (route) => {
        if (!isWorkspaceConfigRequest(route.request())) return route.fallback()
        const url = new URL(route.request().url())
        const request = `${page.url()} -> ${url.pathname}${url.search}`
        bootstrapRequests.push(request)
        await fulfillJson(route, {})
      })

      const protocolReady = waitForProtocol(page, protocol)
      await page.goto("/")
      await protocolReady
      await transport.waitForConnection()
      const row = await addProject(page, protocol)
      const newTask = row.locator("..").locator('[data-action="home-project-new-session"]')
      await newTask.evaluate((button) => {
        ;(button as HTMLButtonElement).click()
        ;(button as HTMLButtonElement).click()
      })

      await expect.poll(() => agentRequests).toBe(2)
      await expect(newTask).toHaveAttribute("aria-busy", "true")
      expect(await persistedDraftTabs(page)).toHaveLength(0)
      agentGate.resolve()

      await expect(page).toHaveURL(/\/new-session\?draftId=/)
      await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
      expect(agentRequests).toBeGreaterThanOrEqual(2)
      expect(await persistedDraftTabs(page)).toHaveLength(1)
      expect(
        bootstrapRequests,
        `workspace bootstrap requests after double click:\n${bootstrapRequests.join("\n")}`,
      ).toHaveLength(1)

      await page.clock.install({ time: Date.now() })
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

    test("recovers after six empty agent responses without leaving a draft", async ({ page }) => {
      let agentRequests = 0
      await setup(page, protocol, async (input) => {
        if (input.directory !== directory) return selectableAgents(protocol)
        agentRequests++
        if (agentRequests <= 6) return []
        return selectableAgents(protocol)
      })

      const protocolReady = waitForProtocol(page, protocol)
      await page.goto("/")
      await protocolReady
      const row = await addProject(page, protocol)
      const newTask = row.locator("..").locator('[data-action="home-project-new-session"]')
      await newTask.click()

      await expect.poll(() => agentRequests, { timeout: 10_000 }).toBe(6)
      await expect(newTask).toBeEnabled()
      await expect(page).toHaveURL(/\/$/)
      expect(await persistedDraftTabs(page)).toHaveLength(0)
      await expect(page.getByText("Failed to reload ImmediateTask", { exact: true })).toBeVisible()

      await newTask.click()
      await expect(page).toHaveURL(/\/new-session\?draftId=/)
      await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
      expect(agentRequests).toBeGreaterThanOrEqual(7)
      expect(await persistedDraftTabs(page)).toHaveLength(1)
    })
  })
}

test("submits immediately after a transient empty V2 agent registry recovers", async ({ page }) => {
  const sessionID = "ses_immediate_task_submit"
  const prompt = "Submit without restarting after adding the project"
  const agentGate = Promise.withResolvers<void>()
  const backgroundGate = Promise.withResolvers<void>()
  const recoveryGate = Promise.withResolvers<void>()
  let agentRequests = 0
  let backgroundRefresh = false
  let backgroundRequests = 0
  await setup(page, "v2", async (input) => {
    if (input.directory !== directory) return selectableAgents("v2")
    agentRequests++
    if (backgroundRefresh) {
      backgroundRequests++
      if (backgroundRequests === 1) await backgroundGate.promise
      if (backgroundRequests <= 6) return []
      await recoveryGate.promise
      return selectableAgents("v2")
    }
    if (agentRequests === 1) return []
    await agentGate.promise
    return selectableAgents("v2")
  })
  const transport = await installSseTransport(page, { server: mockServer })
  const sessionRequests: unknown[] = []
  const promptRequests: unknown[] = []
  await page.route("**/api/session**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === "POST" && url.pathname === "/api/session") {
      sessionRequests.push(route.request().postDataJSON())
      return fulfillJson(route, {
        data: {
          id: sessionID,
          projectID: project.id,
          agent: "build",
          model: { id: "mock-model", providerID: "mock-provider" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
          title: "Immediate task submit",
          location: { directory },
        },
      })
    }
    if (route.request().method() === "POST" && url.pathname === `/api/session/${sessionID}/prompt`) {
      promptRequests.push(route.request().postDataJSON())
      return fulfillJson(route, {
        data: {
          admittedSeq: 1,
          id: "msg_immediate_task_submit",
          sessionID,
          timeCreated: 1_700_000_000_000,
          type: "user",
          data: { text: prompt },
          delivery: "steer",
        },
      })
    }
    return route.fallback()
  })

  const protocolReady = waitForProtocol(page, "v2")
  await page.goto("/")
  await protocolReady
  await transport.waitForConnection()
  const row = await addProject(page, "v2")
  const newTask = row.locator("..").locator('[data-action="home-project-new-session"]')
  await newTask.click()

  await expect.poll(() => agentRequests).toBe(2)
  expect(await persistedDraftTabs(page)).toHaveLength(0)
  agentGate.resolve()

  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  const editor = composer.locator('[data-component="prompt-input"]')
  await editor.fill(prompt)
  const submit = composer.locator('[data-action="prompt-submit"]')
  await expect(submit).toBeEnabled()

  backgroundRefresh = true
  await transport.send({
    directory,
    payload: { id: "evt_agent_background_recovery", type: "agent.updated", properties: {} },
  })
  await expect.poll(() => backgroundRequests).toBe(1)
  await expect(editor).toHaveAttribute("contenteditable", "false")
  await expect(submit).toBeDisabled()
  await submit.evaluate((button) => (button as HTMLButtonElement).click())
  await editor.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })),
  )
  expect(sessionRequests).toHaveLength(0)
  expect(promptRequests).toHaveLength(0)
  await expect(editor).toHaveText(prompt)

  backgroundGate.resolve()
  await expect.poll(() => backgroundRequests, { timeout: 10_000 }).toBe(7)
  await expect(editor).toHaveAttribute("contenteditable", "false")
  await expect(submit).toBeDisabled()
  expect(sessionRequests).toHaveLength(0)
  expect(promptRequests).toHaveLength(0)
  await expect(editor).toHaveText(prompt)

  recoveryGate.resolve()
  await expect(editor).toHaveAttribute("contenteditable", "true")
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  await expect.poll(() => sessionRequests).toHaveLength(1)
  await expect.poll(() => promptRequests).toHaveLength(1)
  expect(sessionRequests[0]).toMatchObject({ agent: "build" })
  expect(
    ((sessionRequests[0] as { location?: { directory?: string } }).location?.directory ?? "").replaceAll("\\", "/"),
  ).toBe(directory)
  expect(promptRequests[0]).toMatchObject({ prompt: { text: prompt } })
  await expect(page.getByText("Select an agent and model", { exact: true })).toHaveCount(0)
})

async function setup(
  page: Page,
  protocol: (typeof protocols)[number],
  agents?: import("../utils/mock-server").MockServerConfig["agents"],
) {
  await setupMockApp(page, {
    directory,
    protocol,
    project,
    projects: [],
    agents,
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

function selectableAgents(protocol: (typeof protocols)[number]) {
  if (protocol === "v1") return [{ name: "build", mode: "primary" }]
  return [
    {
      id: "build",
      name: "Build",
      mode: "primary",
      hidden: false,
      request: { settings: {}, headers: {}, body: {} },
      permissions: [],
    },
  ]
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

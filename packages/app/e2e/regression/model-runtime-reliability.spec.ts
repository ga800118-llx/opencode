import { expect, test, type Page, type Request } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import {
  profileCredentialEnvironment,
  profileCredentialProxyBaseURLEnvironment,
  serializeProviderProfile,
  type ProductProviderProfile,
} from "@opencode-ai/app/product/model-center"
import { createSensitiveHeaderCredentialProxy } from "../../../desktop/src/main/model-center/credential-proxy"
import type { ProductCredentialService } from "../../../desktop/src/main/model-center/credentials"
import { createModelCredentialEnvironment } from "../../../desktop/src/main/model-center/environment"
import type { ProfileRepository } from "../../../desktop/src/main/model-center/profiles"
import { assistantMessage, reasoningPart, setupTimeline, userMessage } from "../performance/timeline-stability/fixture"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"
import { isolateAppStorage, setupMockApp } from "../utils/mac-stability"

test.use({ viewport: { width: 1440, height: 900 } })

const formerRuntimeTimeoutMs = 30_000
const progressAfterTimeoutMs = 1_500
const runtimeServerStartupTimeoutMs = 20_000
const runtimeCompletionTimeoutMs = 10_000
const runtimeAdmissionTimeoutMs = formerRuntimeTimeoutMs + progressAfterTimeoutMs + runtimeCompletionTimeoutMs
const runtimeCleanupBudgetMs = 10_000
const runtimeTestTimeoutMs =
  runtimeServerStartupTimeoutMs +
  APP_READY_TIMEOUT * 3 +
  formerRuntimeTimeoutMs +
  progressAfterTimeoutMs +
  runtimeCompletionTimeoutMs +
  runtimeCleanupBudgetMs
const privatePrompt = "Keep the private model transport running beyond the former timeout"
const firstChunk = "Private transport started"
const finalChunk = " and completed after the former timeout"
const titlePrompt = "Generate a title for this conversation:\n"
type ProviderRequestPurpose = "agent-turn" | "title" | "summary" | "auxiliary"
type PrivateModelRequest = {
  authorization: string | null
  privateHeader: string | null
  body: unknown
  purpose: ProviderRequestPurpose
}

test("removes the user-configurable model runtime timeout field", async ({ page }) => {
  const directory = "C:/OpenCode/ModelRuntimeSettings"
  await setupMockApp(page, { directory })
  await page.goto("/")

  const settings = page.getByRole("button", { name: "Settings", exact: true }).first()
  await expectAppVisible(settings)
  await settings.click()
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("button", { name: "Private endpoint", exact: true }).click()

  const profile = page.locator(".model-profile-dialog")
  await expect(profile).toBeVisible()
  await expect(profile.getByText("Name", { exact: true })).toBeVisible()
  await expect(profile.getByText("Endpoint URL", { exact: true })).toBeVisible()
  await expect(profile.getByText("API key", { exact: true })).toBeVisible()
  await expect(profile.getByLabel(/timeout/i)).toHaveCount(0)
  await expect(profile.getByText(/^timeout$/i)).toHaveCount(0)
})

test("keeps a delayed model request running beyond the former short deadline", async ({ page }) => {
  test.setTimeout(runtimeTestTimeoutMs)
  const browserDiagnostics: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") browserDiagnostics.push(message.text())
  })
  page.on("pageerror", (error) => browserDiagnostics.push(error.stack ?? error.message))
  const apiKey = "e2e-private-api-key"
  const privateHeader = "e2e-private-header"
  const requests: PrivateModelRequest[] = []
  const upstream = await startPrivateModelServer(requests)
  const profile = {
    id: "runtime-e2e",
    providerID: "agent-profile-runtime-e2e",
    name: "Runtime E2E private model",
    kind: "openai-compatible",
    baseURL: `${upstream.url}/v1`,
    credentialRef: "model-profile:runtime-e2e",
    hasApiKey: true,
    headers: [{ name: "X-Private-Token", sensitive: true, hasValue: true }],
    models: [{ id: "runtime-model", name: "Runtime model", source: "manual" }],
    defaultModelID: "runtime-model",
    settings: { contextLimit: 64_000, outputLimit: 8_000, allowInsecureTls: false },
    createdAt: 1,
    updatedAt: 2,
  } satisfies ProductProviderProfile
  const credentials = credentialService(profile.credentialRef, { apiKey, privateHeader })
  const proxy = createSensitiveHeaderCredentialProxy({
    profiles: profileRepository(profile),
    credentials,
    store: { get: () => undefined, set: () => undefined },
    token: () => "e2e-sidecar-proxy-token",
  })

  await proxy.start()
  try {
    const presented = proxy.presentProfile(profile)
    if (!presented.runtime) throw new Error("Credential proxy did not present a runtime endpoint")
    const provider = serializeProviderProfile(presented)
    const environment = createModelCredentialEnvironment({
      profiles: [profile],
      credentials,
      credentialProxy: proxy.runtimeEnvironment,
    })
    expect(provider.options).toMatchObject({
      baseURL: `{env:${profileCredentialProxyBaseURLEnvironment(profile.id)}}`,
      timeout: false,
      headerTimeout: false,
    })
    expect(environment).toMatchObject({
      [profileCredentialEnvironment(profile.id)]: "e2e-sidecar-proxy-token",
      [profileCredentialProxyBaseURLEnvironment(profile.id)]: presented.runtime?.baseURL,
    })

    const home = await mkdtemp(path.join(tmpdir(), "guai-runtime-e2e-"))
    const directory = path.join(home, "project")
    await mkdir(path.join(home, ".config/opencode"), { recursive: true })
    await writeFile(
      path.join(home, ".config/opencode/opencode.json"),
      JSON.stringify({
        model: `${profile.providerID}/runtime-model`,
        provider: {
          [profile.providerID]: {
            ...provider,
            options: {
              ...provider.options,
              baseURL: presented.runtime.baseURL,
              body: { apiKey: "e2e-sidecar-proxy-token" },
            },
            models: {
              "runtime-model": {
                name: "Runtime model",
                tool_call: true,
                cost: { input: 1, output: 1 },
                modalities: { input: ["text"], output: ["text"] },
                limit: { context: 64_000, output: 8_000 },
              },
            },
          },
        },
      }),
    )
    await mkdir(directory)
    await writeFile(path.join(directory, ".gitkeep"), "")
    try {
      const runtime = await startOpenCodeServer({
        cwd: directory,
        home,
        environment,
        providerID: profile.providerID,
        modelID: "runtime-model",
        provider,
      })
      try {
        const browserRequestPaths: string[] = []
        page.on("request", (request) => {
          const url = new URL(request.url())
          if (url.origin === runtime.url) browserRequestPaths.push(url.pathname)
        })
        page.on("response", (response) => {
          const url = new URL(response.url())
          if (url.origin !== runtime.url || url.pathname.includes("event")) return
          browserDiagnostics.push(
            `${response.request().method()} ${url.pathname}${url.search} -> ${response.status()} ${response.headers()["content-type"] ?? "<no content-type>"}`,
          )
        })
        await expectRuntimeReady(runtime.url, directory, profile.providerID)
        const resolvedDirectory = await realpath(directory)
        const sessionResponse = await fetch(`${runtime.url}/api/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: profile.providerID, id: "runtime-model" },
            location: { directory: resolvedDirectory },
          }),
        })
        expect(sessionResponse.ok).toBe(true)
        const session = ((await sessionResponse.json()) as { data: { id: string; title: string } }).data
        const persistedSession = await fetch(`${runtime.url}/api/session/${session.id}`)
        expect(persistedSession.ok).toBe(true)
        expect(await persistedSession.json()).toMatchObject({
          data: {
            id: session.id,
            agent: "build",
            model: { providerID: profile.providerID, id: "runtime-model" },
            location: { directory: resolvedDirectory },
          },
        })
        const modelsURL = `${runtime.url}/api/model?location%5Bdirectory%5D=${encodeURIComponent(resolvedDirectory)}`
        await expect
          .poll(
            async () => {
              const response = await fetch(modelsURL)
              if (!response.ok) return `status:${response.status}`
              return JSON.stringify(await response.json())
            },
            { timeout: APP_READY_TIMEOUT },
          )
          .toContain(profile.providerID)

        const protocolProbes: string[] = []
        await page.route("**/global/health", (route) => {
          if (new URL(route.request().url()).origin !== runtime.url) return route.fallback()
          protocolProbes.push(route.request().url())
          return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
        })
        await page.route("**/api/health", (route) => {
          if (new URL(route.request().url()).origin !== runtime.url) return route.fallback()
          protocolProbes.push(route.request().url())
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ healthy: true, version: "2.0.0", pid: runtime.process.pid }),
          })
        })
        await page.route("**/openapi.json", (route) => {
          if (new URL(route.request().url()).origin !== runtime.url) return route.fallback()
          return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" })
        })
        await page.addInitScript(
          ({ server, directory, providerID }) => {
            localStorage.clear()
            sessionStorage.clear()
            localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
            localStorage.setItem(
              "opencode.global.dat:model",
              JSON.stringify({
                user: [{ providerID, modelID: "runtime-model", visibility: "show" }],
                recent: [],
                variant: {},
              }),
            )
            localStorage.setItem(
              "opencode.global.dat:server",
              JSON.stringify({
                list: [server],
                projects: { [server]: [{ worktree: directory, expanded: true }] },
              }),
            )
          },
          { server: runtime.url, directory: resolvedDirectory, providerID: profile.providerID },
        )
        const sessionHistory = page.waitForResponse(
          (response) => isSessionHistoryRequest(response.request(), runtime.url, session.id),
          { timeout: APP_READY_TIMEOUT },
        )
        const browserModels = page.waitForResponse(
          (response) => {
            const url = new URL(response.url())
            return (
              url.origin === runtime.url &&
              url.pathname === "/api/model" &&
              url.searchParams.get("location[directory]") === resolvedDirectory
            )
          },
          { timeout: APP_READY_TIMEOUT },
        )
        const browserProviders = page.waitForResponse(
          (response) => {
            const url = new URL(response.url())
            return (
              url.origin === runtime.url &&
              url.pathname === "/api/provider" &&
              url.searchParams.get("location[directory]") === resolvedDirectory
            )
          },
          { timeout: APP_READY_TIMEOUT },
        )
        const browserAgents = page.waitForResponse(
          (response) => {
            const url = new URL(response.url())
            return (
              url.origin === runtime.url &&
              url.pathname === "/api/agent" &&
              url.searchParams.get("location[directory]") === resolvedDirectory
            )
          },
          { timeout: APP_READY_TIMEOUT },
        )
        const sessionPath = `/server/${base64Encode(runtime.url)}/session/${session.id}`
        await page.goto(sessionPath)
        const [historyResponse, browserModelsResponse, browserProvidersResponse, browserAgentsResponse] =
          await Promise.all([sessionHistory, browserModels, browserProviders, browserAgents]).catch(async (error) => {
            throw new Error(
              [
                "Browser did not complete the mixed-protocol workspace bootstrap.",
                `Requests: ${browserRequestPaths.join(", ") || "<none>"}`,
                `Responses:\n${browserDiagnostics.join("\n") || "<none>"}`,
                `Page URL: ${page.url()}`,
                `Page text:\n${await page.locator("body").innerText().catch(() => "<unavailable>")}`,
              ].join("\n"),
              { cause: error },
            )
          })
        expect(protocolProbes.some((value) => new URL(value).pathname === "/api/health")).toBe(true)
        expect(protocolProbes.some((value) => new URL(value).pathname === "/global/health")).toBe(false)
        expect(browserRequestPaths).toContain("/doc")
        expect(browserRequestPaths).toContain("/project")
        expect(browserRequestPaths).toContain("/mcp")
        expect(browserRequestPaths).toContain("/experimental/resource")
        expect(browserRequestPaths.some((path) => path.startsWith("/api/project"))).toBe(false)
        expect(browserRequestPaths.some((path) => path.startsWith("/api/mcp"))).toBe(false)
        expect(historyResponse.ok()).toBe(true)
        expect(await historyResponse.json()).toEqual({ data: [], cursor: { next: null, previous: null } })
        const browserModelBody = await browserModelsResponse.json()
        expect(browserModelBody, `Browser V2 models: ${JSON.stringify(browserModelBody, null, 2)}`).toMatchObject({
          data: [
            {
              id: "runtime-model",
              providerID: profile.providerID,
              name: "Runtime model",
              status: "active",
              cost: [{ input: 1, output: 1 }],
            },
          ],
        })
        const browserProviderBody = await browserProvidersResponse.json()
        expect(
          browserProviderBody,
          `Browser V2 providers: ${JSON.stringify(browserProviderBody, null, 2)}`,
        ).toMatchObject({ data: [{ id: profile.providerID }] })
        const browserAgentBody = await browserAgentsResponse.json()
        expect(browserAgentBody, `Browser V2 agents: ${JSON.stringify(browserAgentBody, null, 2)}`).toMatchObject({
          data: expect.arrayContaining([expect.objectContaining({ id: "build" })]),
        })
        expect(new URL(page.url()).pathname).toBe(sessionPath)

        const composer = page.locator('[data-component="prompt-input-v2"]')
        const input = composer.locator('[data-component="prompt-input"]')
        const submit = composer.locator('[data-action="prompt-submit"]')
        await expectAppVisible(composer)
        await expect(page.locator(`a[href="${sessionPath}"]`).first()).toBeVisible()
        expect(session.title).toMatch(/^New session - /)
        await expect(page.getByRole("heading", { level: 1, name: "New session", exact: true })).toBeVisible()
        const modelControl = composer.locator('[data-action="prompt-model"]')
        await expect(
          modelControl,
          `Browser diagnostics:\n${browserDiagnostics.join("\n") || "<none>"}`,
        ).toHaveAttribute("data-control-type", "popover")
        await modelControl.click()
        const runtimeModel = page.locator(`[data-option-key="${profile.providerID}:runtime-model"]`)
        await expect(runtimeModel).toBeVisible()
        await runtimeModel.click()
        await expect(modelControl).toContainText("Runtime model")
        await expect(input).toBeEditable()
        await expect(submit).toBeDisabled()
        await input.fill(privatePrompt)
        await expect(input).toHaveText(privatePrompt)
        await expect(submit).toBeEnabled()

        const promptRequests: Request[] = []
        const onPromptRequest = (request: Request) => {
          if (request.method() !== "POST") return
          const url = new URL(request.url())
          if (url.origin !== runtime.url || !url.pathname.includes("prompt")) return
          promptRequests.push(request)
        }
        page.on("request", onPromptRequest)
        const promptResponsePromise = page
          .waitForResponse((response) => isPromptAdmissionRequest(response.request(), runtime.url, session.id), {
            timeout: runtimeAdmissionTimeoutMs,
          })
          .then(
            (response) => ({ type: "response" as const, response }),
            (error: Error) => ({ type: "error" as const, error }),
          )
        const promptFailure = Promise.withResolvers<Request>()
        const onPromptFailure = (request: Request) => {
          if (isPromptAdmissionRequest(request, runtime.url, session.id)) promptFailure.resolve(request)
        }
        page.on("requestfailed", onPromptFailure)

        await submit.click()
        await expect(page.locator('[data-timeline-row="UserMessage"]').filter({ hasText: privatePrompt }))
          .toBeVisible()
          .catch(async (error) => {
            throw new Error(
              [
                "Prompt submission did not render the optimistic user message.",
                `Observed prompt requests: ${promptRequests.map((request) => request.url()).join(", ") || "<none>"}`,
                `Browser diagnostics: ${browserDiagnostics.join("\n") || "<none>"}`,
                `Page text:\n${await page.locator("body").innerText()}`,
              ].join("\n"),
              { cause: error },
            )
          })

        const admittedRequest = promptRequests.find((request) =>
          isPromptAdmissionRequest(request, runtime.url, session.id),
        )
        if (!admittedRequest) {
          throw new Error(
            `Expected a V2 prompt admission request. Observed:\n${promptRequests.map((request) => request.url()).join("\n") || "<none>"}`,
          )
        }
        const promptPayload = admittedRequest.postDataJSON() as unknown
        expect(isPromptAdmissionPayload(promptPayload)).toBe(true)

        const admission = await Promise.race([
          promptResponsePromise,
          promptFailure.promise.then((request) => ({ type: "request" as const, request })),
        ]).finally(() => page.off("requestfailed", onPromptFailure))
        if (admission.type === "error") throw admission.error
        if (admission.type === "request") {
          throw new Error(
            `Prompt admission request failed: ${admission.request.failure()?.errorText ?? "unknown error"}`,
          )
        }
        const admissionBody = await admission.response.text().catch(() => "")
        expect(
          admission.response.ok(),
          `Prompt admission failed with ${admission.response.status()}: ${admissionBody || "<empty response>"}`,
        ).toBe(true)
        expect(admission.response.status()).toBe(200)

        const promptRequest = await waitForMainProviderRequest(upstream.mainChunkSent.promise, requests)
        expect(promptRequest).toMatchObject({
          authorization: `Bearer ${apiKey}`,
          privateHeader,
          purpose: "agent-turn",
        })
        expect(promptRequest.body).toMatchObject({ model: "runtime-model", stream: true })

        await page.waitForTimeout(formerRuntimeTimeoutMs + 250)
        expect(await settlesWithin(upstream.mainCompleted.promise, 25)).toBe(false)
        const activeResponse = await fetch(`${runtime.url}/api/session/active`)
        expect(activeResponse.ok).toBe(true)
        expect(await activeResponse.json()).toMatchObject({
          data: { [session.id]: { type: "running" } },
        })
        expect(await settlesWithin(upstream.mainCompleted.promise, runtimeCompletionTimeoutMs)).toBe(true)

        const sessionMessages = `${runtime.url}/api/session/${session.id}/message?limit=20&order=desc`
        await expect
          .poll(
            async () => {
              const response = await fetch(sessionMessages)
              if (!response.ok) return `status:${response.status}`
              return JSON.stringify(await response.json())
            },
            { timeout: runtimeCompletionTimeoutMs },
          )
          .toContain(finalChunk.trim())
        expect(await readV2SessionCounts(path.join(home, "opencode.db"), session.id)).toMatchObject({
          sessionInput: 1,
          sessionMessage: 2,
        })

        const reloadedHistory = page.waitForResponse(
          (response) => isSessionHistoryRequest(response.request(), runtime.url, session.id),
          { timeout: APP_READY_TIMEOUT },
        )
        await page.reload()
        expect((await reloadedHistory).ok()).toBe(true)
        await expect(page.getByText(finalChunk.trim(), { exact: false })).toBeVisible({ timeout: APP_READY_TIMEOUT })

        expect(
          requests.filter((request) => request.purpose === "agent-turn"),
          providerRequestDiagnostics(requests),
        ).toHaveLength(1)
        page.off("request", onPromptRequest)
      } finally {
        await stopOpenCodeRuntime(page, runtime)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  } finally {
    try {
      await withTimeout(proxy.stop(), 2_500, "Credential proxy did not stop within the cleanup budget")
    } finally {
      await withTimeout(upstream.stop(), 2_500, "Private model fixture did not stop within the cleanup budget")
    }
  }
})

test("projects slow and unverified activity without stopping the task", async ({ page }) => {
  const now = Date.now()
  await page.clock.install({ time: now })
  await isolateAppStorage(page)
  await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    messages: [
      userMessage(undefined, { created: now - 2_000 }),
      assistantMessage([reasoningPart("prt_runtime_reasoning", "Checking ongoing activity")], {
        completed: false,
        created: now - 1_000,
      }),
    ],
  })

  const process = page.locator('[data-slot="session-turn-thinking"]')
  const label = process
  await expect(process).toBeVisible()
  await expect(label).not.toContainText("Response is slow")

  await page.clock.fastForward(3 * 60_000 + 1_000)
  await expect(label).toContainText("Response is slow; still waiting")
  await expect(page.locator('[data-action="prompt-submit"]')).toHaveAccessibleName("Stop")

  await page.clock.fastForward(7 * 60_000)
  await expect(label).toContainText("Activity cannot be confirmed; task is still running")
  await expect(page.locator('[data-action="prompt-submit"]')).toHaveAccessibleName("Stop")
  await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0)
})

function modelChunk(input: { content?: string; finish?: string }) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-runtime-e2e",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "runtime-model",
    choices: [
      {
        index: 0,
        delta: input.content ? { content: input.content } : {},
        finish_reason: input.finish ?? null,
      },
    ],
  })}\n\n`
}

async function startPrivateModelServer(requests: PrivateModelRequest[]) {
  const mainChunkSent = Promise.withResolvers<PrivateModelRequest>()
  const mainCompleted = Promise.withResolvers<void>()
  const server = createServer((request, response) => {
    void handlePrivateModelRequest(request, response, requests, mainChunkSent, mainCompleted).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: "Private model fixture failed" } }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Private model fixture address is unavailable")
  return {
    url: `http://127.0.0.1:${address.port}`,
    mainChunkSent,
    mainCompleted,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

async function handlePrivateModelRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: PrivateModelRequest[],
  mainChunkSent: ReturnType<typeof Promise.withResolvers<PrivateModelRequest>>,
  mainCompleted: ReturnType<typeof Promise.withResolvers<void>>,
) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  const record = {
    authorization: request.headers.authorization ?? null,
    privateHeader: typeof request.headers["x-private-token"] === "string" ? request.headers["x-private-token"] : null,
    body,
    purpose: providerRequestPurpose(body),
  }
  requests.push(record)
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  if (record.purpose !== "agent-turn") {
    const content =
      record.purpose === "title"
        ? "Private transport title"
        : record.purpose === "summary"
          ? "Private transport summary"
          : "Private transport auxiliary response"
    response.end(`${modelChunk({ content })}${modelChunk({ finish: "stop" })}data: [DONE]\n\n`)
    return
  }

  response.write(modelChunk({ content: firstChunk }))
  mainChunkSent.resolve(record)
  const timer = setTimeout(() => {
    response.end(`${modelChunk({ content: finalChunk })}${modelChunk({ finish: "stop" })}data: [DONE]\n\n`)
    mainCompleted.resolve()
  }, formerRuntimeTimeoutMs + progressAfterTimeoutMs)
  response.once("close", () => clearTimeout(timer))
}

function providerRequestPurpose(body: unknown): ProviderRequestPurpose {
  if (!isRecord(body) || !Array.isArray(body.messages)) return "auxiliary"
  const messages = body.messages.filter(isRecord)
  const userMessages = messages.filter((message) => message.role === "user")
  const content = userMessages.flatMap(modelMessageContent)
  if (content.some((value) => value === titlePrompt)) return "title"
  if (
    content.some(
      (value) =>
        value.startsWith("Create a new anchored summary from the conversation history.") ||
        value.startsWith("Update the anchored summary below using the conversation history above."),
    )
  )
    return "summary"

  const finalUser = userMessages.at(-1)
  const exactPrompt = finalUser ? modelMessageContent(finalUser).some((value) => value === privatePrompt) : false
  const hasSystem = messages.some((message) => message.role === "system" && modelMessageContent(message).length > 0)
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0
  if (body.model === "runtime-model" && body.stream === true && exactPrompt && hasSystem && hasTools)
    return "agent-turn"
  return "auxiliary"
}

function modelMessageContent(message: Record<string, unknown>) {
  if (typeof message.content === "string") return [message.content]
  if (!Array.isArray(message.content)) return []
  return message.content.flatMap((part) => {
    if (typeof part === "string") return [part]
    if (!isRecord(part) || typeof part.text !== "string") return []
    return [part.text]
  })
}

function providerRequestDiagnostics(requests: PrivateModelRequest[]) {
  return `Provider requests:\n${JSON.stringify(
    requests.map((request) => {
      if (!isRecord(request.body)) return { purpose: request.purpose, body: typeof request.body }
      const messages = Array.isArray(request.body.messages) ? request.body.messages.filter(isRecord) : []
      const finalUser = messages.filter((message) => message.role === "user").at(-1)
      return {
        purpose: request.purpose,
        model: request.body.model,
        stream: request.body.stream,
        roles: messages.map((message) => message.role),
        finalUser: finalUser ? modelMessageContent(finalUser) : [],
        systemMessages: messages.filter((message) => message.role === "system").length,
        tools: Array.isArray(request.body.tools) ? request.body.tools.length : 0,
      }
    }),
    null,
    2,
  )}`
}

async function waitForMainProviderRequest(promise: Promise<PrivateModelRequest>, requests: PrivateModelRequest[]) {
  const timeout = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    timeout.reject(
      new Error(`Main provider request did not produce its first SSE chunk.\n${providerRequestDiagnostics(requests)}`),
    )
  }, APP_READY_TIMEOUT)
  try {
    return await Promise.race([promise, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  const timeout = Promise.withResolvers<never>()
  const timer = setTimeout(() => timeout.reject(new Error(message)), timeoutMs)
  try {
    return await Promise.race([promise, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

function isPromptAdmissionRequest(request: Request, server: string, sessionID: string) {
  if (request.method() !== "POST") return false
  const url = new URL(request.url())
  if (url.origin !== server) return false
  return url.pathname === `/api/session/${sessionID}/prompt`
}

function isSessionHistoryRequest(request: Request, server: string, sessionID: string) {
  if (request.method() !== "GET") return false
  const url = new URL(request.url())
  if (url.origin !== server) return false
  return url.pathname === `/api/session/${sessionID}/message`
}

function isPromptAdmissionPayload(payload: unknown) {
  if (!isRecord(payload)) return false
  if (!isRecord(payload.prompt)) return false
  return payload.prompt.text === privatePrompt
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

async function expectRuntimeReady(server: string, directory: string, providerID: string) {
  const health = await fetch(`${server}/global/health`)
  expect(health.ok).toBe(true)
  expect(await health.json()).toMatchObject({ healthy: true })

  const config = await fetch(`${server}/config`, { headers: { "x-opencode-directory": directory } })
  expect(config.ok).toBe(true)
  expect(await config.json()).toMatchObject({
    model: `${providerID}/runtime-model`,
    provider: {
      [providerID]: { options: { timeout: false, headerTimeout: false } },
    },
  })
}

function credentialService(
  reference: string,
  values: { apiKey: string; privateHeader: string },
): ProductCredentialService {
  return {
    capabilities: () => ({
      namespace: "e2e",
      backend: "macos-keychain",
      available: true,
      operations: { read: true, write: true, delete: true },
    }),
    has: (input) => input === reference,
    read: (input) =>
      input === reference ? { apiKey: values.apiKey, headers: { "X-Private-Token": values.privateHeader } } : undefined,
    write: () => undefined,
    delete: () => undefined,
  }
}

function profileRepository(profile: ProductProviderProfile): ProfileRepository {
  return {
    list: () => [profile],
    get: (id) => (id === profile.id ? profile : undefined),
    save: () => profile,
    remove: () => undefined,
    recordTest: () => profile,
    selectDefault: () => profile,
    defaultSelection: () => undefined,
  }
}

async function startOpenCodeServer(input: {
  cwd: string
  home: string
  environment: Readonly<Record<string, string>>
  providerID: string
  modelID: string
  provider: ReturnType<typeof serializeProviderProfile>
}) {
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../opencode/src/index.ts")
  const child = spawn(
    "bun",
    ["run", "--conditions=browser", entry, "serve", "--hostname", "127.0.0.1", "--port", "0", "--cors", origin],
    {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...input.environment,
        HOME: input.home,
        XDG_CONFIG_HOME: path.join(input.home, ".config"),
        XDG_DATA_HOME: path.join(input.home, ".local/share"),
        XDG_STATE_HOME: path.join(input.home, ".local/state"),
        XDG_CACHE_HOME: path.join(input.home, ".cache"),
        OPENCODE_TEST_HOME: input.home,
        OPENCODE_DB: path.join(input.home, "opencode.db"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          formatter: false,
          lsp: false,
          model: `${input.providerID}/${input.modelID}`,
          provider: { [input.providerID]: input.provider },
        }),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_AUTOCOMPACT: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_PURE: "1",
        OPENCODE_AUTH_CONTENT: "{}",
      },
    },
  )
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve))
  const stderr = readStream(child.stderr)
  try {
    return { process: child, url: await readServerURL(child.stdout), exited, stderr }
  } catch (error) {
    child.kill("SIGTERM")
    if (!(await settlesWithin(exited, 2_500))) {
      child.kill("SIGKILL")
      await settlesWithin(exited, 2_500)
    }
    await settlesWithin(stderr, 1_000)
    throw new Error("OpenCode E2E server failed to start", { cause: error })
  }
}

function readServerURL(stream: Readable) {
  return new Promise<string>((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => {
      stream.off("data", onData)
      reject(new Error(`OpenCode E2E server readiness timed out. stdout:\n${output}`))
    }, runtimeServerStartupTimeoutMs)
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const match = output.match(/listening on (http:\/\/[^\s]+)/)
      if (!match?.[1]) return
      clearTimeout(timer)
      stream.off("data", onData)
      resolve(match[1])
    }
    stream.on("data", onData)
  })
}

async function readStream(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

async function readV2SessionCounts(database: string, sessionID: string) {
  const child = spawn(
    "bun",
    [
      "-e",
      [
        'import { Database } from "bun:sqlite"',
        "const db = new Database(process.argv[1], { readonly: true })",
        'const sessionInput = db.query("SELECT COUNT(*) AS count FROM session_input WHERE session_id = ?").get(process.argv[2])',
        'const sessionMessage = db.query("SELECT COUNT(*) AS count FROM session_message WHERE session_id = ?").get(process.argv[2])',
        "console.log(JSON.stringify({ sessionInput: sessionInput.count, sessionMessage: sessionMessage.count }))",
      ].join(";"),
      database,
      sessionID,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  const stdout = readStream(child.stdout)
  const stderr = readStream(child.stderr)
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve))
  const timeout = Promise.withResolvers<"timeout">()
  const timer = setTimeout(() => timeout.resolve("timeout"), 5_000)
  const result = await Promise.race([
    exited.then((code) => ({ type: "exit" as const, code })),
    timeout.promise.then(() => ({ type: "timeout" as const })),
  ]).finally(() => clearTimeout(timer))
  if (result.type === "timeout") {
    child.kill("SIGKILL")
    await Promise.all([settlesWithin(exited, 2_500), settlesWithin(stdout, 1_000), settlesWithin(stderr, 1_000)])
    throw new Error("Timed out while inspecting the V2 session database")
  }
  const [output, errors] = await Promise.all([stdout, stderr])
  const code = result.code
  if (code !== 0) throw new Error(`Failed to inspect V2 session database (${code}): ${errors}`)
  const counts: unknown = JSON.parse(output)
  if (!isRecord(counts) || typeof counts.sessionInput !== "number" || typeof counts.sessionMessage !== "number") {
    throw new Error(`Unexpected V2 session database counts: ${output}`)
  }
  return { sessionInput: counts.sessionInput, sessionMessage: counts.sessionMessage }
}

async function stopOpenCodeRuntime(page: Page, runtime: Awaited<ReturnType<typeof startOpenCodeServer>>) {
  const pageClosed = page.isClosed() ? Promise.resolve() : page.close().catch(() => undefined)
  await settlesWithin(pageClosed, 1_000)
  runtime.process.kill("SIGTERM")
  const terminated = await settlesWithin(runtime.exited, 2_500)
  if (!terminated) runtime.process.kill("SIGKILL")
  if (!terminated && !(await settlesWithin(runtime.exited, 2_500))) {
    throw new Error(`OpenCode E2E server ${runtime.process.pid ?? "unknown"} did not exit after SIGKILL`)
  }
  await Promise.all([settlesWithin(pageClosed, 1_000), settlesWithin(runtime.stderr, 1_000)])
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number) {
  const timeout = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => timeout.resolve(false), timeoutMs)
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout.promise,
    ])
  } finally {
    clearTimeout(timer)
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

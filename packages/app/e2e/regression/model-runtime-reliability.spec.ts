import { expect, test } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
import { expectAppVisible } from "../utils/waits"
import { isolateAppStorage, setupMockApp } from "../utils/mac-stability"

test.use({ viewport: { width: 1440, height: 900 } })

const formerRuntimeTimeoutMs = 30_000
const progressAfterTimeoutMs = 1_500
const privatePrompt = "Keep the private model transport running beyond the former timeout"
const firstChunk = "Private transport started"
const finalChunk = " and completed after the former timeout"

test("removes the user-configurable model runtime timeout field", async ({ page }) => {
  const directory = "C:/OpenCode/ModelRuntimeSettings"
  await setupMockApp(page, { directory })
  await page.goto("/")

  const settings = page.getByRole("button", { name: "Settings", exact: true }).first()
  await expectAppVisible(settings)
  await settings.click()
  const dialog = page.locator(".settings-v2-dialog")
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
  test.setTimeout(90_000)
  const apiKey = "e2e-private-api-key"
  const privateHeader = "e2e-private-header"
  const requests: Array<{ authorization: string | null; privateHeader: string | null; body: unknown }> = []
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
        const sessionResponse = await fetch(`${runtime.url}/session`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-opencode-directory": directory },
          body: JSON.stringify({ title: "Private model runtime E2E" }),
        })
        expect(sessionResponse.ok).toBe(true)
        const session = (await sessionResponse.json()) as { id: string }

        await isolateAppStorage(page, { projects: [{ worktree: directory, expanded: true }] })
        await page.goto(`/server/${base64Encode(runtime.url)}/session/${session.id}`)
        const composer = page.locator('[data-component="prompt-input-v2"]')
        const input = composer.locator('[data-component="prompt-input"]')
        const submit = composer.locator('[data-action="prompt-submit"]')
        await expectAppVisible(composer)
        await input.fill(privatePrompt)
        await submit.click()

        await expect(page.getByText(firstChunk, { exact: false })).toBeVisible({ timeout: 20_000 })
        await expect(submit).toHaveAccessibleName("Stop")
        await page.waitForTimeout(formerRuntimeTimeoutMs + 250)
        await expect(submit).toHaveAccessibleName("Stop")
        await expect(page.getByText(finalChunk.trim(), { exact: false })).toBeVisible({ timeout: 10_000 })
        await expect(submit).not.toHaveAccessibleName("Stop", { timeout: 10_000 })

        const promptRequest = requests.find((request) => JSON.stringify(request.body).includes(privatePrompt))
        expect(promptRequest).toMatchObject({
          authorization: `Bearer ${apiKey}`,
          privateHeader,
        })
        expect(promptRequest?.body).toMatchObject({ model: "runtime-model", stream: true })
      } finally {
        runtime.process.kill()
        await runtime.exited
        await runtime.stderr
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  } finally {
    await proxy.stop()
    await upstream.stop()
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

async function startPrivateModelServer(
  requests: Array<{ authorization: string | null; privateHeader: string | null; body: unknown }>,
) {
  const server = createServer((request, response) => {
    void handlePrivateModelRequest(request, response, requests).catch(() => {
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
  requests: Array<{ authorization: string | null; privateHeader: string | null; body: unknown }>,
) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  requests.push({
    authorization: request.headers.authorization ?? null,
    privateHeader: typeof request.headers["x-private-token"] === "string" ? request.headers["x-private-token"] : null,
    body,
  })
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  if (!JSON.stringify(body).includes(privatePrompt)) {
    response.end(
      `${modelChunk({ content: "Private transport title" })}${modelChunk({ finish: "stop" })}data: [DONE]\n\n`,
    )
    return
  }

  response.write(modelChunk({ content: firstChunk }))
  const timer = setTimeout(() => {
    response.end(`${modelChunk({ content: finalChunk })}${modelChunk({ finish: "stop" })}data: [DONE]\n\n`)
  }, formerRuntimeTimeoutMs + progressAfterTimeoutMs)
  response.once("close", () => clearTimeout(timer))
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
    child.kill()
    await exited
    throw new Error(`OpenCode E2E server failed to start:\n${await stderr}`, { cause: error })
  }
}

function readServerURL(stream: Readable) {
  return new Promise<string>((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => {
      stream.off("data", onData)
      reject(new Error(`OpenCode E2E server readiness timed out. stdout:\n${output}`))
    }, 20_000)
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

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import type { Permission } from "@opencode-ai/schema/permission"
import { createStore } from "solid-js/store"
import type { Prompt, PromptStore } from "@/context/prompt"
import type { ModelSelection } from "@/context/local"
import type {
  ProductCommandInput,
  ProductCreateTaskInput,
  ProductInterruptInput,
  ProductPromptInput,
  ProductShellInput,
  ProductTaskAdapter,
} from "@/product/contracts"
import type { CompatibleApi } from "@/utils/server-compat"
import { createProductTaskAdapter } from "@/product/task-adapter"
import { normalizeSessionInfo } from "@/utils/session"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const sessionCreateInputs: ProductCreateTaskInput[] = []
const enabledAutoAccept: Array<{ server: string; sessionID: string; directory: string }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const sentShell: ProductShellInput[] = []
const syncedDirectories: string[] = []
const promotedDrafts: Array<{ draftID: string; server: string; sessionId: string }> = []
const sentPrompts: string[] = []
const promptInputs: ProductPromptInput[] = []
const sentCommands: ProductCommandInput[] = []
const interruptInputs: ProductInterruptInput[] = []
const commands: Array<{ name: string }> = []
const worktreeCreateInputs: unknown[] = []
const toasts: unknown[] = []
const navigations: unknown[] = []
let serverSessionSyncs = 0
let directSessionCalls = 0

let params: { id?: string } = {}
let search: { draftId?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let permissionServer = "server-a"
let supportsPermissionModes = false
let permissionModeCapability: Promise<boolean> | undefined
let permissionModeCapabilityCalls = 0
let projectPermissionModes: Record<string, Permission.Mode> = {}
let createSessionGate: Promise<void> | undefined
let protocol: "v1" | "v2" = "v2"
let projectMetadata: { commands?: { start?: string } } | undefined
let projectMetadataReady: Promise<unknown> | undefined

let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
const [promptStore, setPromptStore] = createStore<PromptStore>({
  prompt: promptValue,
  cursor: 0,
  context: { items: [] },
})
const prompt = {
  store: [() => promptStore, setPromptStore] as [() => PromptStore, typeof setPromptStore],
  ready: Object.assign(() => true, { promise: Promise.resolve(true) }),
  current: () => promptValue,
  cursor: () => 0,
  dirty: () => true,
  model: {
    current: () => undefined,
    set: () => undefined,
  },
  reset: () => undefined,
  set: () => undefined,
  context: {
    add: () => undefined,
    remove: () => undefined,
    removeComment: () => undefined,
    updateComment: () => undefined,
    replaceComments: () => undefined,
    items: () => [],
  },
  capture: () => prompt,
}

const clientFor = (directory: string) => {
  createdClients.push(directory)
  const direct = async () => {
    directSessionCalls++
    throw new Error("Direct session task API call")
  }
  return {
    api: {
      session: {
        create: direct,
        prompt: direct,
        command: direct,
        shell: direct,
        interrupt: direct,
      },
    },
    session: {
      command: async () => ({ data: undefined }),
      abort: async () => ({ data: undefined }),
    },
    worktree: {
      create: async (input: unknown) => {
        worktreeCreateInputs.push(input)
        return { data: { directory: `${directory}/new` } }
      },
    },
  }
}

const taskAdapter: ProductTaskAdapter<SessionInfo> = {
  async create(input) {
    await createSessionGate
    createdSessions.push(input.directory)
    sessionCreateInputs.push(input)
    const record = {
      id: `session-${createdSessions.length}`,
      projectID: "project",
      agent: input.agent,
      model: { id: input.model.modelID, providerID: input.model.providerID, variant: input.model.variant },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      title: `New session ${createdSessions.length}`,
      location: { directory: input.directory },
    } as SessionInfo
    return {
      task: { id: record.id, directory: record.location.directory, title: record.title },
      record,
    }
  },
  async prompt(input) {
    sentPrompts.push(input.directory)
    promptInputs.push(input)
    return { taskID: input.taskID, operationID: input.messageID }
  },
  async command(input) {
    sentCommands.push(input)
    return { taskID: input.taskID, operationID: input.messageID }
  },
  async shell(input) {
    sentShell.push(input)
    return { taskID: input.taskID, operationID: input.operationID }
  },
  async interrupt(input) {
    interruptInputs.push(input)
  },
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => (value: unknown) => navigations.push(value),
    useParams: () => params,
    useLocation: () => ({}),
    useSearchParams: () => [search, () => undefined],
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    showToast: (value: unknown) => {
      toasts.push(value)
      return 0
    },
    toaster: { create: () => 0 },
  }))

  mock.module("@opencode-ai/core/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => {
    const state = (server: string) => ({
      projectMode(directory: string) {
        return projectPermissionModes[directory] ?? "standard"
      },
      supportsModes() {
        return supportsPermissionModes
      },
      supportsModesAsync() {
        permissionModeCapabilityCalls++
        return permissionModeCapability ?? Promise.resolve(supportsPermissionModes)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ server, sessionID, directory })
      },
    })
    return { usePermission: () => ({ currentServerState: () => state(permissionServer) }) }
  })

  mock.module("@/context/server", () => ({
    useServer: () => ({ key: "server-key" }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      draft: () => ({ server: "project-server" }),
      promoteDraft: (draftID: string, session: { server: string; sessionId: string }) => {
        promotedDrafts.push({ draftID, ...session })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        scope: "local",
        protocol: Promise.resolve(protocol),
        directory: "/repo/main",
        client: rootClient,
        api: rootClient.api,
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return () => sdk
    },
  }))

  mock.module("@/product/context", () => ({
    useProductTaskAdapter: () => () => taskAdapter,
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      data: { command: commands },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/server-sync", () => ({
    useServerSync: () => () => ({
      data: { project: [{ worktree: "/repo/main" }] },
      session: {
        remember: () => undefined,
        set: () => undefined,
        sync: async () => {
          serverSessionSyncs++
        },
      },
      child: Object.assign(
        (directory: string) => {
          syncedDirectories.push(directory)
          storedSessions[directory] ??= []
          return [
            { session: storedSessions[directory], projectMeta: projectMetadata },
            (...args: unknown[]) => {
              if (args[0] !== "session") return
              const next = args[1]
              if (typeof next === "function") {
                storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
                return
              }
              if (Array.isArray(next)) {
                storedSessions[directory] = next as Array<{ id: string; title?: string }>
              }
            },
          ]
        },
        { ready: () => projectMetadataReady },
      ),
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
})

beforeEach(() => {
  createdClients.length = 0
  createdSessions.length = 0
  sessionCreateInputs.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  promotedDrafts.length = 0
  sentPrompts.length = 0
  promptInputs.length = 0
  sentCommands.length = 0
  interruptInputs.length = 0
  commands.length = 0
  worktreeCreateInputs.length = 0
  toasts.length = 0
  navigations.length = 0
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  params = {}
  search = {}
  sentShell.length = 0
  syncedDirectories.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  permissionServer = "server-a"
  supportsPermissionModes = false
  permissionModeCapability = undefined
  permissionModeCapabilityCalls = 0
  projectPermissionModes = {}
  createSessionGate = undefined
  protocol = "v2"
  projectMetadata = undefined
  projectMetadataReady = undefined
  serverSessionSyncs = 0
  directSessionCalls = 0
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sessionCreateInputs).toEqual([
      {
        agent: "agent",
        directory: "/repo/worktree-a",
        model: { modelID: "model", providerID: "provider", variant: undefined },
      },
      {
        agent: "agent",
        directory: "/repo/worktree-b",
        model: { modelID: "model", providerID: "provider", variant: undefined },
      },
    ])
    expect(sentShell).toEqual([
      expect.objectContaining({ taskID: "session-1", operationID: expect.stringMatching(/^evt_/), command: "ls" }),
      expect.objectContaining({ taskID: "session-2", operationID: expect.stringMatching(/^evt_/), command: "ls" }),
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(serverSessionSyncs).toBe(0)
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(directSessionCalls).toBe(0)
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
  })

  test("waits for V2 project metadata hydration before creating a worktree", async () => {
    selected = "create"
    const hydration = Promise.withResolvers<void>()
    projectMetadataReady = hydration.promise.then(() => {
      projectMetadata = { commands: { start: "bun run dev" } }
    })
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const result = submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    await Promise.resolve()
    expect(worktreeCreateInputs).toEqual([])

    hydration.resolve()
    await result

    expect(worktreeCreateInputs).toEqual([
      { directory: "/repo/main", worktreeCreateInput: { projectStartCommandOverride: "bun run dev" } },
    ])
  })

  test("retries V2 worktree creation after project metadata readiness fails", async () => {
    selected = "create"
    projectMetadataReady = Promise.reject(new Error("metadata unavailable"))
    let resets = 0
    let submits = 0
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => resets++,
      onSubmit: () => submits++,
    })

    await expect(submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)).resolves.toBeUndefined()

    expect(toasts).toEqual([
      {
        title: "prompt.toast.worktreeCreateFailed.title",
        description: "metadata unavailable",
      },
    ])
    expect(worktreeCreateInputs).toEqual([])
    expect(createdSessions).toEqual([])
    expect(promoted).toEqual([])
    expect(navigations).toEqual([])
    expect(resets).toBe(0)
    expect(submits).toBe(0)
    expect(prompt.current()).toEqual([{ type: "text", content: "ls", start: 0, end: 2 }])

    projectMetadataReady = Promise.resolve().then(() => {
      projectMetadata = { commands: { start: "bun run dev" } }
    })
    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(worktreeCreateInputs).toEqual([
      { directory: "/repo/main", worktreeCreateInput: { projectStartCommandOverride: "bun run dev" } },
    ])
    expect(createdSessions).toEqual(["/repo/main/new"])
    expect(promoted).toEqual([{ directory: "/repo/main/new", sessionID: "session-1" }])
    expect(navigations).toHaveLength(1)
    expect(resets).toBe(1)
    expect(submits).toBe(1)
  })

  test("does not wait for project metadata hydration when creating a V1 worktree", async () => {
    selected = "create"
    protocol = "v1"
    projectMetadataReady = new Promise(() => {})
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(worktreeCreateInputs).toEqual([{ directory: "/repo/main" }])
    expect(syncedDirectories).not.toContain("/repo/main")
  })

  test("omits unsupported permission modes and applies legacy auto-accept after creation", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect("permissionMode" in sessionCreateInputs[0]!).toBe(false)
    expect(enabledAutoAccept).toEqual([{ server: "server-a", sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("keeps auto-accept bound to the submission server", async () => {
    let release = () => {}
    createSessionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const result = submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    permissionServer = "server-b"
    release()
    await result

    expect(enabledAutoAccept).toEqual([{ server: "server-a", sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("creates a V2 task atomically with the selected project's auto mode", async () => {
    supportsPermissionModes = true
    projectPermissionModes["/repo/worktree-a"] = "auto"
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(sessionCreateInputs[0]).toMatchObject({ directory: "/repo/worktree-a", permissionMode: "auto" })
    expect(enabledAutoAccept).toEqual([])
  })

  test("waits for a pending capability before creating with the project mode", async () => {
    const capability = Promise.withResolvers<boolean>()
    permissionModeCapability = capability.promise
    projectPermissionModes["/repo/worktree-a"] = "auto"
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const result = submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Bun.sleep(0)
    expect(sessionCreateInputs).toEqual([])

    capability.resolve(true)
    await result

    expect(permissionModeCapabilityCalls).toBe(1)
    expect(sessionCreateInputs[0]).toMatchObject({ permissionMode: "auto" })
    expect(enabledAutoAccept).toEqual([])
  })

  test("falls back to legacy auto-accept after a pending unsupported result", async () => {
    const capability = Promise.withResolvers<boolean>()
    permissionModeCapability = capability.promise
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const result = submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Bun.sleep(0)
    expect(sessionCreateInputs).toEqual([])

    capability.resolve(false)
    await result

    expect(permissionModeCapabilityCalls).toBe(1)
    expect("permissionMode" in sessionCreateInputs[0]!).toBe(false)
    expect(enabledAutoAccept).toEqual([{ server: "server-a", sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("promotes drafts using the selected project's server", async () => {
    search = { draftId: "draft-1" }
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(promotedDrafts).toEqual([{ draftID: "draft-1", server: "project-server", sessionId: "session-1" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await Bun.sleep(0)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
    expect(sentPrompts).toEqual(["/repo/main"])
    expect(promptInputs[0]).toMatchObject({
      taskID: "session-1",
      directory: "/repo/main",
      agent: "agent",
      model: { providerID: "provider", modelID: "model", variant: "high" },
    })
    expect(promptInputs[0]?.messageID).toStartWith("msg_")
    expect(promptInputs[0]?.parts).toEqual([{ id: expect.stringMatching(/^prt_/), type: "text", text: "ls" }])
    expect(permissionModeCapabilityCalls).toBe(0)
    expect(directSessionCalls).toBe(0)
  })

  test("submits slash commands through the product adapter", async () => {
    params = { id: "session-1" }
    variant = "high"
    commands.push({ name: "review" })
    promptValue = [{ type: "text", content: "/review staged changes", start: 0, end: 22 }]

    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(sentCommands).toEqual([
      {
        taskID: "session-1",
        directory: "/repo/main",
        messageID: expect.stringMatching(/^msg_/),
        command: "review",
        arguments: "staged changes",
        agent: "agent",
        model: { modelID: "model", providerID: "provider", variant: "high" },
        files: [],
      },
    ])
    expect(serverSessionSyncs).toBe(0)
    expect(directSessionCalls).toBe(0)
  })

  test("uses an injected model selection", async () => {
    params = { id: "session-1" }
    const model = {
      current: () => ({ id: "draft-model", provider: { id: "draft-provider" } }),
      variant: { current: () => "draft-variant" },
    } as unknown as ModelSelection
    const submit = createPromptSubmit({
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      model,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(optimistic[0]).toMatchObject({
      message: {
        model: { providerID: "draft-provider", modelID: "draft-model", variant: "draft-variant" },
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toHaveLength(1)
    expect(storedSessions["/repo/worktree-a"]?.[0]).toMatchObject({ id: "session-1", title: "New session 1" })
    expect(optimisticSeeded).toEqual([true])
  })
})

describe("task creation contracts", () => {
  test("forwards permission mode through the product adapter", async () => {
    const calls: unknown[] = []
    const api = {
      session: {
        create: async (input: unknown) => {
          calls.push(input)
          return {
            id: "session",
            projectID: "project",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            title: "Task",
            location: { directory: "/repo" },
          } as SessionInfo
        },
      },
    } as unknown as CompatibleApi

    await createProductTaskAdapter(api).create({
      directory: "/repo",
      agent: "agent",
      model: { modelID: "model", providerID: "provider" },
      permissionMode: "restricted",
    })

    expect(calls).toEqual([
      {
        agent: "agent",
        model: { id: "model", providerID: "provider", variant: undefined },
        permissionMode: "restricted",
        location: { directory: "/repo" },
      },
    ])
  })

  test("preserves permission mode while normalizing a current session", () => {
    const session = normalizeSessionInfo({
      id: "session",
      projectID: "project",
      permissionMode: "auto",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      title: "Task",
      location: { directory: "/repo" },
    })

    expect(session.permissionMode).toBe("auto")
  })
})

import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Schema } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { createComponent, createEffect, createSignal, type Accessor, type JSX, type ParentProps } from "solid-js"
import { insert, render } from "solid-js/web"
import { build } from "vite"
import solid from "vite-plugin-solid"
import type { ServerSDK } from "@/context/server-sdk"
import { dict } from "@/i18n/en"
import { SkillManagementRequestError, type SkillManagementApi } from "@/utils/skill-management-api"

type Toast = { title?: string; description?: string }

const toasts: Toast[] = []
const disposers: Array<() => void> = []
let sdkAccessor: Accessor<ServerSDK> = () => {
  throw new Error("SDK accessor not configured")
}
let SettingsSkillsV2: typeof import("../src/components/settings-v2/skills").SettingsSkillsV2
let DialogProvider: typeof import("@opencode-ai/ui/context/dialog").DialogProvider
let useDialog: typeof import("@opencode-ai/ui/context/dialog").useDialog

beforeAll(async () => {
  mock.module("@/context/language", () => ({
    useLanguage: () => ({ t: translate }),
  }))
  mock.module("@/context/server-sdk", () => ({
    useServerSDK: () => sdkAccessor,
  }))
  mock.module("@/utils/toast", () => ({
    showToast: (toast: Toast | string) => toasts.push(typeof toast === "string" ? { title: toast } : toast),
  }))
  mock.module("@opencode-ai/ui/v2/badge-v2", () => ({ Tag: container("span") }))
  mock.module("@opencode-ai/ui/v2/button-v2", () => ({ ButtonV2: testButton }))
  mock.module("@opencode-ai/ui/v2/dialog-v2", () => ({
    Dialog: container("div"),
    DialogBody: container("div"),
    DialogFooter: container("div"),
    DialogHeader: container("div"),
    DialogTitle: container("h2"),
  }))
  mock.module("@opencode-ai/ui/v2/divider-v2", () => ({ DividerV2: () => document.createElement("hr") }))
  mock.module("@opencode-ai/ui/v2/icon-button-v2", () => ({ IconButtonV2: testIconButton }))
  mock.module("@opencode-ai/ui/v2/segmented-control-v2", () => ({
    SegmentedControlItemV2: container("button"),
    SegmentedControlV2: container("div"),
  }))
  mock.module("@opencode-ai/ui/v2/switch-v2", () => ({ Switch: testSwitch }))
  mock.module("@opencode-ai/ui/v2/text-input-v2", () => ({ TextInputV2: testInput }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => document.createElement("span") }))
  const runtime = await loadComponent()
  SettingsSkillsV2 = runtime.SettingsSkillsV2
  DialogProvider = runtime.DialogProvider
  useDialog = runtime.useDialog
})

afterEach(() => {
  while (disposers.length) disposers.pop()?.()
  toasts.length = 0
  document.body.replaceChildren()
})

describe("SettingsSkillsV2", () => {
  test("keeps a transient empty first response in the loading state", async () => {
    const item = fixture({ id: "cold-start", name: "cold-start" })
    const request = deferred<Skill.ManagementInfo[]>()
    const current = server("scope", [])
    current.behavior.list = async () => (current.listCalls === 1 ? [] : request.promise)
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )

    await waitFor(() => current.listCalls === 2)
    expect(view.host.textContent).toContain("Loading Skills...")
    expect(view.host.textContent).not.toContain("0 installed")
    expect(view.host.textContent).not.toContain("No Skills installed.")

    request.resolve([item])
    await waitFor(() => view.host.textContent?.includes("cold-start") === true)
    expect(view.host.textContent).toContain("1 installed")
  })

  test("closes an invalid covered confirmation only after it becomes active again", async () => {
    const item = fixture({ id: "old", name: "old-skill", deletable: true })
    const oldServer = server("old-scope", [item])
    const nextServer = server("next-scope", [])
    const [route, setRoute] = createSignal({ directory: "/old", sdk: oldServer.sdk })
    const view = mount(
      () => route().directory,
      () => route().sdk,
    )
    await waitFor(() => view.host.textContent?.includes("old-skill") === true)

    click(view.host.querySelector('button[aria-label="Delete old-skill"]'))
    await waitFor(() => document.body.textContent?.includes("Remove old-skill") === true)
    const confirmationID = view.dialog().active?.id
    const externalID = await pushExternalDialog(view, "new-dialog")
    setRoute({ directory: "/next", sdk: nextServer.sdk })
    await tick()

    expect(view.dialog().active?.id).toBe(externalID)
    expect(button(document.body, "Delete").disabled).toBe(true)

    escape()
    expect(view.dialog().active?.id).toBe(externalID)
    await waitFor(() => view.dialog().active?.id === confirmationID)
    expect(view.dialog().active?.id).toBe(confirmationID)
    await waitFor(() => view.dialog().active === undefined)

    expect(view.dialog().active).toBeUndefined()
    expect(oldServer.removeCalls).toEqual([])
    expect(nextServer.removeCalls).toEqual([])
  })

  test("does not close another dialog after overlay dismisses a pending confirmation", async () => {
    const item = fixture({ id: "delete-race", name: "delete-race", deletable: true })
    const request = deferred<Skill.ManagementInfo[]>()
    const current = server("scope", [item])
    current.behavior.remove = async () => request.promise
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    await waitFor(() => view.host.textContent?.includes("delete-race") === true)

    click(view.host.querySelector('button[aria-label="Delete delete-race"]'))
    await waitFor(() => document.body.textContent?.includes("Remove delete-race") === true)
    click(button(document.body, "Delete"))
    await waitFor(() => current.removeCalls.length === 1)

    click(Array.from(document.querySelectorAll('[data-component="dialog-overlay"]')).at(-1))
    expect(view.dialog().active).toBeDefined()
    await waitFor(() => view.dialog().active === undefined)
    const nextDialog = await pushExternalDialog(view, "next-dialog")
    request.resolve([])
    await waitFor(() => current.listCalls > 1)
    await Promise.resolve()

    expect(view.dialog().active?.id).toBe(nextDialog)
    expect(view.host.isConnected).toBe(true)
  })

  test("keeps a non-empty search available when the list shrinks from two items to one", async () => {
    const alpha = fixture({ id: "alpha", name: "alpha" })
    const beta = fixture({ id: "beta", name: "beta" })
    const current = server("scope", [alpha, beta])
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    const search = await find<HTMLInputElement>(view.host, 'input[aria-label="Search Skills"]')
    input(search, "beta")
    view.client.setQueryData([current.sdk.scope, "/repo", "skill-management"], [beta])
    await tick()

    expect(view.host.querySelector('input[aria-label="Search Skills"]')).not.toBeNull()
    input(search, "")
    await waitFor(() => view.host.querySelector('input[aria-label="Search Skills"]') === null)
    expect(view.host.textContent).toContain("beta")
  })

  test("refreshes the exact list after a missing installation response", async () => {
    const item = fixture({ id: "missing", name: "missing" })
    const current = server("scope", [item])
    current.behavior.setEnabled = async () => {
      throw new SkillManagementRequestError(404)
    }
    current.behavior.list = async () => (current.listCalls === 1 ? [item] : [])
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    const toggle = await find<HTMLInputElement>(view.host, 'input[type="checkbox"]')
    click(toggle)
    await waitFor(() => current.listCalls > 1 && !view.host.textContent?.includes("missing"))

    expect(toasts.at(-1)?.title).toBe("Request failed")
    expect(toasts.at(-1)?.description).toBe("Could not disable missing.")
  })

  test("keeps the immediate mutation result but reports an authoritative refresh failure", async () => {
    const item = fixture({ id: "refresh", name: "refresh" })
    const disabled = fixture({ id: "refresh", name: "refresh", enabled: false, status: "disabled" })
    const current = server("scope", [item])
    current.behavior.setEnabled = async () => [disabled]
    current.behavior.list = async () => {
      if (current.listCalls === 1) return [item]
      throw new Error("refresh failed")
    }
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    const toggle = await find<HTMLInputElement>(view.host, 'input[type="checkbox"]')
    click(toggle)
    await waitFor(() => toasts.at(-1)?.title === "Request failed")

    const currentToggle = view.host.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(currentToggle?.checked).toBe(false)
    expect(currentToggle?.disabled).toBe(false)
    expect(view.client.getQueryData([current.sdk.scope, "/repo", "skill-management"])).toEqual([disabled])
    expect(view.host.textContent).toContain("Disabled")
    expect(toasts.at(-1)?.description).toBe("Could not disable refresh.")
  })

  test("refreshes captured inactive context without blocking the same ID in a new scope", async () => {
    const oldItem = fixture({ id: "shared-id", name: "old-skill" })
    const oldStale = fixture({ id: "shared-id", name: "old-stale", enabled: false, status: "disabled" })
    const oldAuthority = fixture({ id: "shared-id", name: "old-authority", enabled: false, status: "disabled" })
    const nextItem = fixture({ id: "shared-id", name: "next-skill" })
    const nextStale = fixture({ id: "shared-id", name: "next-stale", enabled: false, status: "disabled" })
    const nextAuthority = fixture({ id: "shared-id", name: "next-authority", enabled: false, status: "disabled" })
    const oldRequest = deferred<Skill.ManagementInfo[]>()
    const nextRequest = deferred<Skill.ManagementInfo[]>()
    const oldServer = server("old-scope", [oldItem])
    const nextServer = server("next-scope", [nextItem])
    oldServer.behavior.setEnabled = async () => oldRequest.promise
    nextServer.behavior.setEnabled = async () => nextRequest.promise
    oldServer.behavior.list = async () => (oldServer.listCalls === 1 ? [oldItem] : [oldAuthority])
    nextServer.behavior.list = async () => (nextServer.listCalls === 1 ? [nextItem] : [nextAuthority])
    const [route, setRoute] = createSignal({ directory: "/old", sdk: oldServer.sdk })
    const view = mount(
      () => route().directory,
      () => route().sdk,
    )
    const oldToggle = await find<HTMLInputElement>(view.host, 'input[type="checkbox"]')
    click(oldToggle)
    await waitFor(() => oldServer.setEnabledCalls.length === 1)

    setRoute({ directory: "/next", sdk: nextServer.sdk })
    await waitFor(() => view.host.textContent?.includes("next-skill") === true)
    const nextToggle = await find<HTMLInputElement>(view.host, 'input[type="checkbox"]')
    expect(nextToggle.disabled).toBe(false)
    click(nextToggle)
    await waitFor(() => nextServer.setEnabledCalls.length === 1)

    nextRequest.resolve([nextStale])
    await waitFor(() => nextServer.listCalls === 2)
    oldRequest.resolve([oldStale])
    await waitFor(() => oldServer.listCalls === 2)
    await waitFor(
      () =>
        view.client.getQueryData<Skill.ManagementInfo[]>([oldServer.sdk.scope, "/old", "skill-management"])?.[0]
          ?.name === "old-authority",
    )

    expect(view.client.getQueryData([oldServer.sdk.scope, "/old", "skill-management"])).toEqual([oldAuthority])
    expect(view.client.getQueryData([nextServer.sdk.scope, "/next", "skill-management"])).toEqual([nextAuthority])
    expect(oldServer.setEnabledCalls).toHaveLength(1)
    expect(nextServer.setEnabledCalls).toHaveLength(1)
  })

  test("continues captured cache refresh without local writes after the Skill view unmounts", async () => {
    const item = fixture({ id: "unmount", name: "unmount" })
    const stale = fixture({ id: "unmount", name: "unmount-stale", enabled: false, status: "disabled" })
    const authority = fixture({ id: "unmount", name: "unmount-authority", enabled: false, status: "disabled" })
    const request = deferred<Skill.ManagementInfo[]>()
    const current = server("scope", [item])
    current.behavior.setEnabled = async () => request.promise
    current.behavior.list = async () => (current.listCalls === 1 ? [item] : [authority])
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    click(await find<HTMLInputElement>(view.host, 'input[type="checkbox"]'))
    await waitFor(() => current.setEnabledCalls.length === 1)

    view.unmountSkills()
    await tick()
    expect(view.host.textContent).not.toContain("unmount description")
    request.resolve([stale])
    await waitFor(() => current.listCalls === 2)
    await waitFor(
      () =>
        view.client.getQueryData<Skill.ManagementInfo[]>([current.sdk.scope, "/repo", "skill-management"])?.[0]
          ?.name === "unmount-authority",
    )

    expect(view.client.getQueryData([current.sdk.scope, "/repo", "skill-management"])).toEqual([authority])
    expect(view.dialog().active).toBeUndefined()
  })

  test("concurrent installation responses converge on the final authoritative refetch", async () => {
    const alpha = fixture({ id: "alpha", name: "alpha" })
    const beta = fixture({ id: "beta", name: "beta" })
    const alphaDisabled = fixture({ id: "alpha", name: "alpha", enabled: false, status: "disabled" })
    const betaDisabled = fixture({ id: "beta", name: "beta", enabled: false, status: "disabled" })
    const alphaRequest = deferred<Skill.ManagementInfo[]>()
    const betaRequest = deferred<Skill.ManagementInfo[]>()
    const firstRefresh = deferred<Skill.ManagementInfo[]>()
    const current = server("scope", [alpha, beta])
    current.behavior.setEnabled = async (_directory, id) =>
      id === alpha.id ? alphaRequest.promise : betaRequest.promise
    current.behavior.list = async () => {
      if (current.listCalls === 1) return [alpha, beta]
      if (current.listCalls === 2) return firstRefresh.promise
      return [alphaDisabled, betaDisabled]
    }
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    const toggles = await findAll<HTMLInputElement>(view.host, 'input[type="checkbox"]', 2)
    click(toggles[0])
    click(toggles[1])
    betaRequest.resolve([alpha, betaDisabled])
    await waitFor(() => current.listCalls === 2)
    alphaRequest.resolve([alphaDisabled, beta])
    firstRefresh.resolve([alpha, betaDisabled])
    await waitFor(() => current.listCalls === 3)
    await waitFor(() =>
      Array.from(view.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every(
        (toggle) => !toggle.checked && !toggle.disabled,
      ),
    )

    expect(current.setEnabledCalls).toHaveLength(2)
    expect(view.client.getQueryData([current.sdk.scope, "/repo", "skill-management"])).toEqual([
      alphaDisabled,
      betaDisabled,
    ])
    expect(toasts.filter((toast) => toast.title?.startsWith("Disabled"))).toHaveLength(2)
  })

  test("shows the protected reason without rendering a delete action", async () => {
    const builtin = fixture({
      id: "builtin",
      name: "builtin",
      source: { type: "builtin", scope: "global", value: "builtin" },
      deletable: false,
      deleteBlocked: "builtin",
    })
    const shared = fixture({
      id: "shared",
      name: "agent-browser",
      source: { type: "external", scope: "global", value: "/Users/test/.agents/skills" },
      deletable: false,
      deleteBlocked: "shared",
    })
    const current = server("scope", [builtin, shared])
    const view = mount(
      () => "/repo",
      () => current.sdk,
    )
    await waitFor(() => view.host.textContent?.includes("Built-in skill") === true)

    expect(view.host.querySelector('button[aria-label="Delete builtin"]')).toBeNull()
    expect(view.host.querySelector('button[aria-label="Delete agent-browser"]')).toBeNull()
    expect(view.host.textContent).toContain("Built-in skill")
    expect(view.host.textContent).toContain("Shared directory")
    expect(view.host.textContent).toContain("Shared with other agent applications")
  })
})

function mount(directory: Accessor<string>, sdk: Accessor<ServerSDK>) {
  sdkAccessor = sdk
  const [visible, setVisible] = createSignal(true)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  const host = document.createElement("div")
  document.body.append(host)
  let dialog: ReturnType<typeof useDialog> | undefined
  const DialogProbe = () => {
    dialog = useDialog()
    return undefined
  }
  const dispose = render(
    () =>
      createComponent(DialogProvider, {
        get children() {
          return [
            createComponent(DialogProbe, {}),
            createComponent(QueryClientProvider, {
              client,
              get children() {
                if (!visible()) return
                return createComponent(SettingsSkillsV2, {
                  get directory() {
                    return directory()
                  },
                })
              },
            }),
          ]
        },
      }),
    host,
  )
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    dispose()
    client.clear()
    host.remove()
  }
  disposers.push(cleanup)
  return {
    client,
    host,
    dialog: () => {
      if (!dialog) throw new Error("Dialog controller was not mounted")
      return dialog
    },
    unmountSkills: () => setVisible(false),
    dispose: cleanup,
  }
}

async function pushExternalDialog(view: ReturnType<typeof mount>, text: string) {
  await view.dialog().push(() => {
    const element = document.createElement("div")
    element.dataset.testDialog = text
    element.textContent = text
    return element
  })
  const id = view.dialog().active?.id
  if (!id) throw new Error("External dialog did not become active")
  return id
}

function escape() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
}

function server(scope: string, initial: Skill.ManagementInfo[]) {
  const setEnabledCalls: Array<{ directory: string; id: Skill.ManagementID; enabled: boolean }> = []
  const removeCalls: Array<{ directory: string; id: Skill.ManagementID }> = []
  const behavior = {
    list: async (_directory: string) => initial,
    setEnabled: async (_directory: string, _id: Skill.ManagementID, _enabled: boolean) => initial,
    remove: async (_directory: string, _id: Skill.ManagementID) => initial,
  }
  const result = {
    behavior,
    listCalls: 0,
    setEnabledCalls,
    removeCalls,
    sdk: undefined as unknown as ServerSDK,
  }
  const skillManagement: SkillManagementApi = {
    list: (directory) => {
      result.listCalls++
      return behavior.list(directory)
    },
    setEnabled: (directory, id, enabled) => {
      setEnabledCalls.push({ directory, id, enabled })
      return behavior.setEnabled(directory, id, enabled)
    },
    remove: (directory, id) => {
      removeCalls.push({ directory, id })
      return behavior.remove(directory, id)
    },
  }
  result.sdk = { scope, skillManagement } as ServerSDK
  return result
}

function fixture(input: {
  id: string
  name: string
  enabled?: boolean
  status?: "active" | "disabled" | "shadowed"
  source?: {
    type: "builtin" | "directory" | "external" | "url" | "plugin"
    scope: "global" | "project"
    value: string
  }
  deletable?: boolean
  deleteBlocked?: "builtin" | "remote" | "plugin" | "shared" | "unsafe"
}) {
  return Schema.decodeUnknownSync(Skill.ManagementInfo)({
    id: input.id,
    name: input.name,
    description: `${input.name} description`,
    location: `/repo/${input.name}/SKILL.md`,
    source: input.source ?? { type: "directory", scope: "project", value: "/repo" },
    status: input.status ?? "active",
    enabled: input.enabled ?? true,
    deletable: input.deletable ?? false,
    ...(input.deletable ? { deleteTarget: `/repo/${input.name}` } : {}),
    ...(input.deleteBlocked ? { deleteBlocked: input.deleteBlocked } : {}),
  })
}

async function loadComponent() {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [solid()],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: new URL("./settings-skills-harness.ts", import.meta.url).pathname,
        formats: ["es"],
      },
      rollupOptions: {
        external: (id) =>
          id === "solid-js" ||
          id === "solid-js/store" ||
          id === "@tanstack/solid-query" ||
          (id.startsWith("@opencode-ai/") && id !== "@opencode-ai/ui/context/dialog") ||
          id.startsWith("@/"),
      },
    },
  })
  const chunk = (Array.isArray(output) ? output : [output])
    .flatMap((result) => result.output)
    .find((item) => item.type === "chunk")
  if (!chunk || chunk.type !== "chunk") throw new Error("Skill component build did not produce JavaScript")
  const compiled = new URL("./.settings-skills-test-runtime.mjs", import.meta.url)
  await Bun.write(compiled, chunk.code)
  try {
    return (await import(`${compiled.href}?v=${Date.now()}`)) as {
      SettingsSkillsV2: typeof SettingsSkillsV2
      DialogProvider: typeof DialogProvider
      useDialog: typeof useDialog
    }
  } finally {
    await Bun.file(compiled).delete()
  }
}

type ElementProps = ParentProps & {
  class?: string
  title?: string
  disabled?: boolean
  onClick?: () => void
}

function container<Tag extends keyof HTMLElementTagNameMap>(tag: Tag) {
  return (props: ElementProps) => {
    const element = document.createElement(tag)
    createEffect(() => {
      element.className = props.class ?? ""
      if (props.title) element.title = props.title
    })
    insert(element, () => props.children)
    return element
  }
}

function testButton(props: ElementProps) {
  const element = document.createElement("button")
  element.addEventListener("click", () => props.onClick?.())
  createEffect(() => {
    element.disabled = props.disabled ?? false
  })
  insert(element, () => props.children)
  return element
}

function testIconButton(props: ElementProps & { "aria-label"?: string }) {
  const element = document.createElement("button")
  element.addEventListener("click", () => props.onClick?.())
  createEffect(() => {
    element.disabled = props.disabled ?? false
    element.title = props.title ?? ""
    element.setAttribute("aria-label", props["aria-label"] ?? "")
  })
  return element
}

function testInput(props: {
  value?: string
  type?: string
  placeholder?: string
  "aria-label"?: string
  onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>
}) {
  const element = document.createElement("input")
  element.addEventListener("input", (event) =>
    props.onInput?.(event as InputEvent & { currentTarget: HTMLInputElement }),
  )
  createEffect(() => {
    element.value = props.value ?? ""
    element.type = props.type ?? "text"
    element.placeholder = props.placeholder ?? ""
    element.setAttribute("aria-label", props["aria-label"] ?? "")
  })
  return element
}

function testSwitch(
  props: ParentProps & {
    checked?: boolean
    disabled?: boolean
    onChange?: (checked: boolean) => void
  },
) {
  const element = document.createElement("input")
  element.type = "checkbox"
  element.addEventListener("change", () => props.onChange?.(element.checked))
  createEffect(() => {
    element.checked = props.checked ?? false
    element.disabled = props.disabled ?? false
    element.setAttribute("aria-label", String(props.children ?? ""))
  })
  return element
}

function translate(key: string, params?: Record<string, string | number | boolean>) {
  const source = (dict as Record<string, string>)[key] ?? key
  return Object.entries(params ?? {}).reduce((value, [name, replacement]) => {
    return value.replaceAll(`{{${name}}}`, String(replacement))
  }, source)
}

function deferred<Value>() {
  let resolve = (_value: Value) => {}
  let reject = (_error: unknown) => {}
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("Expected clickable element")
  element.click()
}

function input(element: HTMLInputElement, value: string) {
  element.value = value
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
}

function button(host: ParentNode, text: string) {
  const result = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.trim() === text)
  if (!result) throw new Error(`Button not found: ${text}`)
  return result
}

async function find<ElementType extends Element>(host: ParentNode, selector: string) {
  await waitFor(() => host.querySelector(selector) !== null)
  return host.querySelector(selector) as ElementType
}

async function findAll<ElementType extends Element>(host: ParentNode, selector: string, count: number) {
  await waitFor(() => host.querySelectorAll(selector).length === count)
  return Array.from(host.querySelectorAll(selector)) as ElementType[]
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (condition()) return
    await tick()
  }
  throw new Error("Timed out waiting for component state")
}

async function tick() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

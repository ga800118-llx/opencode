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
import {
  SkillManagementRequestError,
  type SkillManagementApi,
} from "@/utils/skill-management-api"

type Toast = { title?: string; description?: string }
type DialogEntry = {
  id: string
  host: HTMLDivElement
  dispose: () => void
  onClose?: () => void
}

const toasts: Toast[] = []
const disposers: Array<() => void> = []
let sdkAccessor: Accessor<ServerSDK> = () => {
  throw new Error("SDK accessor not configured")
}
let SettingsSkillsV2: typeof import("../src/components/settings-v2/skills").SettingsSkillsV2

const dialogs = (() => {
  const stack: DialogEntry[] = []
  let sequence = 0
  let closes = 0
  const api = {
    get active() {
      const current = stack.at(-1)
      return current ? { id: current.id } : undefined
    },
    push(factory: () => unknown, onClose?: () => void) {
      const host = document.createElement("div")
      const entry: DialogEntry = {
        id: `dialog-${++sequence}`,
        host,
        dispose: () => {},
        onClose,
      }
      document.body.append(host)
      stack.push(entry)
      entry.dispose = render(factory, host)
      return Promise.resolve()
    },
    close() {
      const current = stack.pop()
      if (!current) return
      closes++
      current.onClose?.()
      current.dispose()
      current.host.remove()
    },
    external() {
      const host = document.createElement("div")
      const entry: DialogEntry = {
        id: `external-${++sequence}`,
        host,
        dispose: () => {},
      }
      document.body.append(host)
      stack.push(entry)
      return entry.id
    },
    current() {
      return stack.at(-1)
    },
    reset() {
      while (stack.length) {
        const current = stack.pop()!
        current.dispose()
        current.host.remove()
      }
      closes = 0
    },
    closeCount() {
      return closes
    },
  }
  return api
})()

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
  mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => dialogs }))
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
  SettingsSkillsV2 = await loadComponent()
})

afterEach(() => {
  while (disposers.length) disposers.pop()?.()
  dialogs.reset()
  toasts.length = 0
  document.body.replaceChildren()
})

describe("SettingsSkillsV2", () => {
  test("invalidates an open delete snapshot when directory and server change", async () => {
    const item = fixture({ id: "old", name: "old-skill", deletable: true })
    const oldServer = server("old-scope", [item])
    const nextServer = server("next-scope", [])
    const [route, setRoute] = createSignal({ directory: "/old", sdk: oldServer.sdk })
    const view = mount(() => route().directory, () => route().sdk)
    await waitFor(() => view.host.textContent?.includes("old-skill") === true)

    click(view.host.querySelector('button[aria-label="Delete old-skill"]'))
    await waitFor(() => dialogs.current()?.host.textContent?.includes("old-skill") === true)
    const confirm = button(dialogs.current()!.host, "Delete")
    dialogs.external()
    setRoute({ directory: "/next", sdk: nextServer.sdk })
    await tick()
    click(confirm)
    await tick()

    expect(oldServer.removeCalls).toEqual([])
    expect(nextServer.removeCalls).toEqual([])
  })

  test("does not close another dialog after the pending confirmation was dismissed", async () => {
    const item = fixture({ id: "delete-race", name: "delete-race", deletable: true })
    const request = deferred<Skill.ManagementInfo[]>()
    const current = server("scope", [item])
    current.behavior.remove = async () => request.promise
    const view = mount(() => "/repo", () => current.sdk)
    await waitFor(() => view.host.textContent?.includes("delete-race") === true)

    click(view.host.querySelector('button[aria-label="Delete delete-race"]'))
    await waitFor(() => dialogs.current()?.host.textContent?.includes("delete-race") === true)
    click(button(dialogs.current()!.host, "Delete"))
    await waitFor(() => current.removeCalls.length === 1)
    dialogs.close()
    const nextDialog = dialogs.external()
    request.resolve([])
    await waitFor(() => current.listCalls > 1)
    await tick()

    expect(dialogs.active?.id).toBe(nextDialog)
    expect(dialogs.closeCount()).toBe(1)
    expect(view.host.isConnected).toBe(true)
  })

  test("keeps a non-empty search available when the list shrinks from two items to one", async () => {
    const alpha = fixture({ id: "alpha", name: "alpha" })
    const beta = fixture({ id: "beta", name: "beta" })
    const current = server("scope", [alpha, beta])
    const view = mount(() => "/repo", () => current.sdk)
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
    const view = mount(() => "/repo", () => current.sdk)
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
    const view = mount(() => "/repo", () => current.sdk)
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

  test("concurrent installation responses converge on the final authoritative refetch", async () => {
    const alpha = fixture({ id: "alpha", name: "alpha" })
    const beta = fixture({ id: "beta", name: "beta" })
    const alphaDisabled = fixture({ id: "alpha", name: "alpha", enabled: false, status: "disabled" })
    const betaDisabled = fixture({ id: "beta", name: "beta", enabled: false, status: "disabled" })
    const alphaRequest = deferred<Skill.ManagementInfo[]>()
    const betaRequest = deferred<Skill.ManagementInfo[]>()
    const firstRefresh = deferred<Skill.ManagementInfo[]>()
    const current = server("scope", [alpha, beta])
    current.behavior.setEnabled = async (_directory, id) => (id === alpha.id ? alphaRequest.promise : betaRequest.promise)
    current.behavior.list = async () => {
      if (current.listCalls === 1) return [alpha, beta]
      if (current.listCalls === 2) return firstRefresh.promise
      return [alphaDisabled, betaDisabled]
    }
    const view = mount(() => "/repo", () => current.sdk)
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
    const item = fixture({
      id: "builtin",
      name: "builtin",
      source: { type: "builtin", scope: "global", value: "builtin" },
      deletable: false,
      deleteBlocked: "builtin",
    })
    const current = server("scope", [item])
    const view = mount(() => "/repo", () => current.sdk)
    await waitFor(() => view.host.textContent?.includes("Built-in skill") === true)

    expect(view.host.querySelector('button[aria-label="Delete builtin"]')).toBeNull()
    expect(view.host.textContent).toContain("Built-in skill")
  })
})

function mount(directory: Accessor<string>, sdk: Accessor<ServerSDK>) {
  sdkAccessor = sdk
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () =>
      createComponent(QueryClientProvider, {
        client,
        get children() {
          return createComponent(SettingsSkillsV2, {
            get directory() {
              return directory()
            },
          })
        },
      }),
    host,
  )
  disposers.push(() => {
    dispose()
    client.clear()
    host.remove()
  })
  return { client, host }
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
  source?: { type: "builtin" | "directory" | "url" | "plugin"; scope: "global" | "project"; value: string }
  deletable?: boolean
  deleteBlocked?: "builtin" | "remote" | "plugin" | "unsafe"
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
        entry: new URL("../src/components/settings-v2/skills.tsx", import.meta.url).pathname,
        formats: ["es"],
      },
      rollupOptions: {
        external: (id) =>
          id === "solid-js" ||
          id === "solid-js/store" ||
          id === "@tanstack/solid-query" ||
          id.startsWith("@opencode-ai/") ||
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
    return (await import(`${compiled.href}?v=${Date.now()}`)).SettingsSkillsV2 as typeof SettingsSkillsV2
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

function testInput(
  props: {
    value?: string
    type?: string
    placeholder?: string
    "aria-label"?: string
    onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>
  },
) {
  const element = document.createElement("input")
  element.addEventListener("input", (event) => props.onInput?.(event as InputEvent & { currentTarget: HTMLInputElement }))
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
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await tick()
  }
  throw new Error("Timed out waiting for component state")
}

async function tick() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

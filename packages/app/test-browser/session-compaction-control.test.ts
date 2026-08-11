import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createComponent, createEffect, type ParentProps } from "solid-js"
import { insert, render } from "solid-js/web"
import { build } from "vite"
import solid from "vite-plugin-solid"

let SessionCompactionControl: typeof import("@/components/session/session-compaction-control").SessionCompactionControl

beforeAll(async () => {
  mock.module("@opencode-ai/ui/spinner", () => ({ Spinner: testSpinner }))
  mock.module("@opencode-ai/ui/v2/button-v2", () => ({ ButtonV2: testButton }))
  mock.module("@opencode-ai/ui/v2/tooltip-v2", () => ({ TooltipV2: container("div") }))
  SessionCompactionControl = await loadComponent()
})

function renderControl(input: { disabled: boolean; pending?: boolean }) {
  const root = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(SessionCompactionControl, {
        label: "Compact session",
        description: "Wait for the response to finish",
        disabled: input.disabled,
        pending: input.pending ?? false,
        onRun: () => {},
      }),
    root,
  )
  const wrapper = root.querySelector<HTMLElement>('[data-component="session-compaction-control"]')
  const button = root.querySelector<HTMLButtonElement>("button")
  const description = root.querySelector<HTMLElement>(".sr-only")
  if (!wrapper || !button || !description) throw new Error("compaction control required")
  return { wrapper, button, description, dispose }
}

describe("SessionCompactionControl", () => {
  test("keeps a disabled reason keyboard-accessible", () => {
    const control = renderControl({ disabled: true })
    try {
      expect(control.wrapper.tabIndex).toBe(0)
      expect(control.wrapper.getAttribute("aria-disabled")).toBe("true")
      expect(control.wrapper.getAttribute("aria-describedby")).toBe(control.description.id)
      expect(control.button.disabled).toBe(true)
      expect(control.button.tabIndex).toBe(-1)
      expect(control.description.textContent).toBe("Wait for the response to finish")
    } finally {
      control.dispose()
    }
  })

  test("keeps the enabled button in the tab order and exposes pending state", () => {
    const control = renderControl({ disabled: false, pending: true })
    try {
      expect(control.wrapper.hasAttribute("tabindex")).toBe(false)
      expect(control.button.disabled).toBe(false)
      expect(control.button.tabIndex).toBe(0)
      expect(control.button.getAttribute("aria-busy")).toBe("true")
      expect(control.button.querySelector('[data-component="spinner"]')).not.toBeNull()
    } finally {
      control.dispose()
    }
  })
})

async function loadComponent() {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [solid()],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: new URL("../src/components/session/session-compaction-control.tsx", import.meta.url).pathname,
        formats: ["es"],
      },
      rollupOptions: {
        external: (id) => id === "solid-js" || id.startsWith("@opencode-ai/"),
      },
    },
  })
  const chunk = (Array.isArray(output) ? output : [output])
    .flatMap((result) => result.output)
    .find((item) => item.type === "chunk")
  if (!chunk || chunk.type !== "chunk") throw new Error("Compaction control build did not produce JavaScript")
  const compiled = new URL("./.session-compaction-control-runtime.mjs", import.meta.url)
  await Bun.write(compiled, chunk.code)
  try {
    return (await import(`${compiled.href}?v=${Date.now()}`))
      .SessionCompactionControl as typeof SessionCompactionControl
  } finally {
    await Bun.file(compiled).delete()
  }
}

type ElementProps = ParentProps & {
  disabled?: boolean
  tabIndex?: number
  onClick?: () => void
  "aria-busy"?: boolean
  "aria-describedby"?: string
}

function container<Tag extends keyof HTMLElementTagNameMap>(tag: Tag) {
  return (props: ParentProps) => {
    const element = document.createElement(tag)
    insert(element, () => props.children)
    return element
  }
}

function testButton(props: ElementProps) {
  const button = document.createElement("button")
  createEffect(() => {
    button.disabled = props.disabled ?? false
    if (props.tabIndex === undefined) button.removeAttribute("tabindex")
    if (props.tabIndex !== undefined) button.tabIndex = props.tabIndex
    setAttribute(button, "aria-busy", props["aria-busy"])
    setAttribute(button, "aria-describedby", props["aria-describedby"])
  })
  button.addEventListener("click", () => props.onClick?.())
  insert(button, () => props.children)
  return button
}

function testSpinner(props: { class?: string }) {
  const spinner = document.createElement("span")
  spinner.dataset.component = "spinner"
  spinner.className = props.class ?? ""
  return spinner
}

function setAttribute(element: HTMLElement, name: string, value: string | boolean | undefined) {
  if (value === undefined || value === false) {
    element.removeAttribute(name)
    return
  }
  element.setAttribute(name, String(value))
}

import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { detectOpenAppOS, openAppsForOS } from "@/components/session/open-in-app"
import { createOpenSessionFileTab } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { ServerScope } from "@/utils/server-scope"
import { fileManagerApp } from "@/utils/file-manager"
import { showToast } from "@/utils/toast"
import {
  messageFileReferenceFromTarget,
  type ResolvedMessageFileReference,
} from "./message-file-reference"

type MessageFileActionControllerInput = {
  directory: () => string
  local: () => boolean
  openInternal: (path: string) => void
  openPath?: (path: string, app?: string) => Promise<void>
  revealPath?: (path: string) => Promise<boolean>
  copyPath?: (path: string) => Promise<void>
  onInvalid?: (path: string) => void
  onMissing?: (path: string) => void
  onError?: (error: unknown) => void
}

const editorApps = new Set(["vscode", "cursor", "zed", "textmate", "antigravity", "xcode", "android-studio", "sublime-text"])

export function messageFileMenuPosition(
  point: { x: number; y: number },
  origin?: { left: number; top: number },
) {
  return {
    x: point.x - (origin?.left ?? 0),
    y: point.y - (origin?.top ?? 0),
  }
}

export function createMessageFileActionController(input: MessageFileActionControllerInput) {
  const resolve = (event: Event, reportInvalid: boolean) => {
    const target = messageFileReferenceFromTarget(event.target, input.directory())
    if (!target) return
    if (target.resolved) return { element: target.element, reference: target.reference, resolved: target.resolved }
    event.preventDefault()
    if (reportInvalid) input.onInvalid?.(target.reference.path)
    return { element: target.element, reference: target.reference, invalid: true as const }
  }

  const run = (action: Promise<unknown> | undefined) => {
    if (!action) return Promise.resolve()
    return action.then(
      () => undefined,
      (error) => input.onError?.(error),
    )
  }

  const openInternal = (reference: ResolvedMessageFileReference) => {
    input.openInternal(reference.relativePath)
  }

  const openWith = (reference: ResolvedMessageFileReference, app?: string) => {
    if (!input.local()) return Promise.resolve()
    return run(input.openPath?.(reference.absolutePath, app))
  }

  const reveal = (reference: ResolvedMessageFileReference) => {
    if (!input.local() || !input.revealPath) return Promise.resolve()
    return input.revealPath(reference.absolutePath).then(
      (exists) => {
        if (!exists) input.onMissing?.(reference.absolutePath)
      },
      (error) => input.onError?.(error),
    )
  }

  const copy = (reference: ResolvedMessageFileReference) => run(input.copyPath?.(reference.absolutePath))

  return {
    click(event: MouseEvent) {
      const target = resolve(event, true)
      if (!target) return false
      if ("invalid" in target) return true
      event.preventDefault()
      openInternal(target.resolved)
      return true
    },
    doubleClick(event: MouseEvent) {
      const target = resolve(event, true)
      if (!target) return false
      if ("invalid" in target) return true
      event.preventDefault()
      void openWith(target.resolved)
      return true
    },
    context(event: MouseEvent) {
      const target = resolve(event, true)
      if (!target) return
      if ("invalid" in target) return
      event.preventDefault()
      return target.resolved
    },
    hover(event: MouseEvent) {
      const target = resolve(event, false)
      if (!target || "invalid" in target) return false
      target.element.dataset.messageFileReference = "true"
      target.element.title = target.resolved.absolutePath
      return true
    },
    openInternal,
    openWith,
    reveal,
    copy,
  }
}

export function useMessageFileActions() {
  const file = useFile()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const layout = useSessionLayout()
  const [menu, setMenu] = createStore({
    open: false,
    x: 0,
    y: 0,
    reference: undefined as ResolvedMessageFileReference | undefined,
  })
  const [apps, setApps] = createSignal<Array<{ id: string; label: string; openWith: string }>>([])
  let appsLoaded = false
  let menuTrigger: HTMLButtonElement | undefined

  const openTab = createOpenSessionFileTab({
    normalizeTab: file.tab,
    openTab: (tab) => layout.tabs().open(tab),
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel: () => {
      if (!layout.view().reviewPanel.opened()) layout.view().reviewPanel.open()
    },
    setActive: (tab) => layout.tabs().setActive(tab),
  })

  const local = () => serverSDK().scope === ServerScope.local
  const localDesktop = () => local() && platform.platform === "desktop"
  const failure = (error: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  const invalid = (path: string) =>
    showToast({ variant: "error", title: language.t("toast.file.loadFailed.title"), description: path })
  const controller = createMessageFileActionController({
    directory: () => sdk().directory,
    local,
    openInternal: openTab,
    openPath: platform.openPath,
    revealPath: platform.revealPath,
    copyPath: (path) => navigator.clipboard.writeText(path),
    onInvalid: invalid,
    onMissing: invalid,
    onError: failure,
  })

  const loadApps = () => {
    const checkAppExists = platform.checkAppExists
    if (appsLoaded || !localDesktop() || !checkAppExists) return
    appsLoaded = true
    const options = openAppsForOS(detectOpenAppOS(platform)).filter((app) => editorApps.has(app.id))
    void Promise.all(
      options.map((app) =>
        checkAppExists(app.openWith)
          .then((exists) => (exists ? { id: app.id, label: language.t(app.label), openWith: app.openWith } : undefined))
          .catch(() => undefined),
      ),
    ).then((items) => setApps(items.filter((item): item is NonNullable<typeof item> => !!item)))
  }

  const contextMenu = (event: MouseEvent) => {
    const reference = controller.context(event)
    if (!reference) return false
    setMenu({
      open: true,
      ...messageFileMenuPosition(
        { x: event.clientX, y: event.clientY },
        menuTrigger?.offsetParent?.getBoundingClientRect(),
      ),
      reference,
    })
    loadApps()
    return true
  }

  const manager = () => fileManagerApp(detectOpenAppOS(platform))
  const menuView = () => (
    <MenuV2
      open={menu.open}
      onOpenChange={(open) => setMenu({ open, reference: open ? menu.reference : undefined })}
      placement="bottom-start"
      gutter={2}
    >
      <MenuV2.Trigger
        ref={menuTrigger}
        as="button"
        type="button"
        tabindex={-1}
        aria-hidden="true"
        class="fixed size-px opacity-0 pointer-events-none"
        style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      />
      <MenuV2.Portal>
        <Show when={menu.reference} keyed>
          {(reference) => (
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => controller.openInternal(reference)}>
                {language.t("command.file.open")}
              </MenuV2.Item>
              <Show when={localDesktop()}>
                <MenuV2.Item onSelect={() => void controller.openWith(reference)}>
                  {language.t("common.open")}
                </MenuV2.Item>
                <Show when={apps().length > 0}>
                  <MenuV2.Sub>
                    <MenuV2.SubTrigger>{language.t("session.header.openIn")}</MenuV2.SubTrigger>
                    <MenuV2.SubContent>
                      <For each={apps()}>
                        {(app) => (
                          <MenuV2.Item onSelect={() => void controller.openWith(reference, app.openWith)}>
                            {app.label}
                          </MenuV2.Item>
                        )}
                      </For>
                    </MenuV2.SubContent>
                  </MenuV2.Sub>
                </Show>
                <MenuV2.Item onSelect={() => void controller.reveal(reference)}>
                  {language.t(manager().actionLabel)}
                </MenuV2.Item>
              </Show>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => void controller.copy(reference)}>
                {language.t("session.header.open.copyPath")}
              </MenuV2.Item>
            </MenuV2.Content>
          )}
        </Show>
      </MenuV2.Portal>
    </MenuV2>
  )

  return {
    click: controller.click,
    doubleClick: controller.doubleClick,
    hover: controller.hover,
    contextMenu,
    menu: menuView,
  }
}

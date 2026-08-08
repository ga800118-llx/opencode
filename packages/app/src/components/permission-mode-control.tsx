import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Permission } from "@opencode-ai/schema/permission"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"

type RequestPermissionModeInput = {
  mode: Permission.Mode
  confirmed: boolean
  confirm: () => Promise<boolean>
  markConfirmed: () => void
  setMode: (mode: Permission.Mode) => Promise<unknown>
}

export async function requestPermissionMode(input: RequestPermissionModeInput) {
  if (input.mode !== "auto" || input.confirmed) {
    await input.setMode(input.mode)
    return true
  }

  if (!(await input.confirm())) return false
  input.markConfirmed()
  await input.setMode(input.mode)
  return true
}

export function permissionModeDialogMethod(nested = false) {
  return nested ? "push" : "show"
}

export function usePermissionModeRequester(input?: { onClose?: () => void; nested?: boolean }) {
  const dialog = useDialog()
  const language = useLanguage()
  const permission = usePermission()

  const confirmAuto = () =>
    new Promise<boolean>((resolve) => {
      const decision = { settled: false }
      const finish = (approved: boolean) => {
        if (decision.settled) return
        decision.settled = true
        resolve(approved)
        dialog.close()
      }

      void dialog[permissionModeDialogMethod(input?.nested)](
        () => (
          <DialogV2 fit>
            <DialogHeader hideClose>
              <DialogTitleGroup
                title={language.t("permission.mode.auto.confirm.title")}
                description={language.t("permission.mode.auto.confirm.description")}
              />
            </DialogHeader>
            <DialogFooter>
              <ButtonV2 variant="neutral" autofocus onClick={() => finish(false)}>
                {language.t("permission.mode.auto.confirm.cancel")}
              </ButtonV2>
              <ButtonV2 variant="warning" onClick={() => finish(true)}>
                {language.t("permission.mode.auto.confirm.action")}
              </ButtonV2>
            </DialogFooter>
          </DialogV2>
        ),
        () => {
          if (!decision.settled) {
            decision.settled = true
            resolve(false)
          }
          input?.onClose?.()
        },
      )
    })

  return (value: { sessionID?: string; directory: string; mode: Permission.Mode }) =>
    requestPermissionMode({
      mode: value.mode,
      confirmed: permission.autoConfirmed(value.directory),
      confirm: confirmAuto,
      markConfirmed: () => permission.confirmAuto(value.directory),
      setMode: (mode) => permission.setMode({ ...value, mode }),
    })
}

export function PermissionModeControl(props: {
  sessionID?: string
  onClose?: () => void
  defaultOpen?: boolean
}) {
  const language = useLanguage()
  const permission = usePermission()
  const sdk = useSDK()
  const requestMode = usePermissionModeRequester({ onClose: props.onClose })
  const [switching, setSwitching] = createSignal(false)
  const directory = () => sdk().directory
  const mode = () => permission.mode(props.sessionID, directory())
  const options = createMemo(
    () =>
      [
        {
          id: "restricted",
          label: language.t("permission.mode.restricted.label"),
          description: language.t("permission.mode.restricted.description"),
        },
        {
          id: "standard",
          label: language.t("permission.mode.standard.label"),
          description: language.t("permission.mode.standard.description"),
        },
        {
          id: "auto",
          label: language.t("permission.mode.auto.label"),
          description: language.t("permission.mode.auto.description"),
        },
      ] satisfies Array<{ id: Permission.Mode; label: string; description: string }>,
  )
  const current = () => options().find((option) => option.id === mode()) ?? options()[1]

  const select = async (next: Permission.Mode) => {
    if (switching() || next === mode()) return
    setSwitching(true)
    await requestMode({ sessionID: props.sessionID, directory: directory(), mode: next }).finally(() =>
      setSwitching(false),
    )
  }

  const request = (next: string) => {
    void select(next as Permission.Mode).catch((error: unknown) =>
      showToast({
        variant: "error",
        title: language.t("permission.mode.switchFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  return (
    <Show when={permission.supportsModes()}>
      <MenuV2
        gutter={6}
        modal={false}
        placement="top-start"
        defaultOpen={props.defaultOpen}
        onOpenChange={(open) => {
          if (!open) props.onClose?.()
        }}
      >
        <MenuV2.Trigger
          as={ButtonV2}
          type="button"
          variant="ghost-muted"
          size="normal"
          disabled={switching()}
          class="max-w-[148px] min-w-0 justify-start ![font-weight:440]"
          aria-label={`${language.t("permission.mode.label")}: ${current().label}`}
        >
          <Icon name="shield" class="shrink-0" />
          <span class="truncate whitespace-nowrap leading-5">{current().label}</span>
          <span class="-ml-0.5 -mr-1 flex shrink-0">
            <Icon name="chevron-down" />
          </span>
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content style={{ width: "min(320px, calc(100vw - 24px))", "min-width": "0" }}>
            <MenuV2.RadioGroup value={mode()} onChange={request}>
              <For each={options()}>
                {(option) => (
                  <MenuV2.RadioItem
                    value={option.id}
                    closeOnSelect
                    style={{ height: "auto", "min-height": "48px", padding: "8px 10px" }}
                    class="[&_[data-slot=menu-v2-item-content]]:items-start"
                  >
                    <span class="flex min-w-0 flex-col gap-1">
                      <span class="flex items-center gap-1">
                        <Show when={option.id === "auto"}>
                          <Icon name="warning" size="small" class="text-v2-state-fg-warning" />
                        </Show>
                        <span
                          data-permission-mode-label={option.id}
                          class="whitespace-nowrap text-[13px] font-[530] leading-4"
                        >
                          {option.label}
                        </span>
                      </span>
                      <span class="text-[11px] font-[440] leading-4 text-v2-text-text-muted">
                        {option.description}
                      </span>
                    </span>
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}

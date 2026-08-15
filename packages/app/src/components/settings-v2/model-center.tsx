import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Icon as LegacyIcon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useProductRuntime } from "@/product/context"
import {
  createModelCenterController,
  type ProductProviderKind,
  type ProductProviderProfile,
} from "@/product/model-center"
import { showToast } from "@/utils/toast"
import { DialogModelProfile } from "./dialog-model-profile"
import { ModelCapabilityStatus } from "./model-capability-status"
import { SettingsListV2 } from "./parts/list"

const KIND_LABELS = {
  "openai-compatible": "settings.modelCenter.kind.private",
  ollama: "settings.modelCenter.kind.ollama",
  "lm-studio": "settings.modelCenter.kind.lmStudio",
  "custom-local": "settings.modelCenter.kind.customLocal",
} as const

export const SettingsModelCenterV2: Component<{ onOpenProviders: () => void }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const runtime = useProductRuntime()
  const serverSync = useServerSync()
  const controller = createModelCenterController({
    modelCenter: runtime.host.modelCenter,
    refreshRuntime: () => serverSync().refreshProviders({ throwOnError: true }),
  })
  const [capabilities] = createResource(() => controller.capabilities())
  const [profiles, { mutate }] = createResource(() => controller.list())

  const connectedCloud = createMemo(() =>
    serverSync().data.provider.connected.filter((id) => !id.startsWith("agent-profile-")),
  )
  const defaultProfile = createMemo(() => {
    const value = serverSync().data.config.model
    if (typeof value !== "string") return undefined
    return profiles()?.find((profile) => value.startsWith(`${profile.providerID}/`))
  })
  const defaultModel = createMemo(() => {
    const profile = defaultProfile()
    if (!profile) return undefined
    const configured = serverSync().data.config.model
    const id = typeof configured === "string" ? configured.slice(profile.providerID.length + 1) : profile.defaultModelID
    return profile.models.find((model) => model.id === id)
  })

  const changed = async () => {
    mutate(await controller.list())
  }

  const open = (input: { profile?: ProductProviderProfile; kind?: ProductProviderKind; detect?: boolean } = {}) => {
    void dialog.push(() => (
      <DialogModelProfile
        operations={controller}
        profile={input.profile}
        initialKind={input.kind}
        detectOnOpen={input.detect}
        onChanged={changed}
      />
    ))
  }

  const remove = (profile: ProductProviderProfile) => {
    void dialog.push(() => (
      <DialogDeleteModelProfile profile={profile} remove={controller.remove} onChanged={changed} />
    ))
  }

  const host = (value: string) => {
    try {
      return new URL(value).host
    } catch {
      return value
    }
  }

  const testedAt = (profile: ProductProviderProfile) => {
    if (!profile.test) return language.t("settings.modelCenter.status.neverTested")
    return new Intl.DateTimeFormat(language.intl(), { dateStyle: "medium", timeStyle: "short" }).format(
      profile.test.testedAt,
    )
  }

  return (
    <div class="settings-model-center">
      <section class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.modelCenter.default.title")}</h3>
        <SettingsListV2>
          <div class="model-center-default-row">
            <div class="model-center-source-mark" aria-hidden="true">
              <LegacyIcon name="models" size="small" />
            </div>
            <div class="model-center-source-copy">
              <Show
                when={defaultProfile() && defaultModel()}
                fallback={
                  <>
                    <strong>{language.t("settings.modelCenter.default.empty")}</strong>
                    <span>{language.t("settings.modelCenter.default.emptyDescription")}</span>
                  </>
                }
              >
                <strong>{defaultModel()!.name}</strong>
                <span>
                  {defaultProfile()!.name} / {defaultModel()!.id}
                </span>
              </Show>
            </div>
            <ButtonV2
              size="normal"
              variant="neutral"
              onClick={() => (defaultProfile() ? open({ profile: defaultProfile() }) : props.onOpenProviders())}
            >
              {language.t("settings.modelCenter.default.change")}
            </ButtonV2>
          </div>
        </SettingsListV2>
      </section>

      <section class="settings-v2-section">
        <div class="model-center-section-heading">
          <h3 class="settings-v2-section-title">{language.t("settings.modelCenter.sources.title")}</h3>
          <div class="model-center-add-actions">
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => open()}>
              {language.t("settings.modelCenter.sources.private")}
            </ButtonV2>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => open({ kind: "custom-local" })}>
              {language.t("settings.modelCenter.sources.customLocal")}
            </ButtonV2>
            <ButtonV2
              size="normal"
              variant="neutral"
              icon="reset"
              onClick={() => open({ kind: "ollama", detect: true })}
            >
              {language.t("settings.modelCenter.sources.detectLocal")}
            </ButtonV2>
          </div>
        </div>

        <Show when={capabilities()?.available === false}>
          <div class="model-center-host-notice">{language.t("settings.modelCenter.desktopRequired")}</div>
        </Show>

        <SettingsListV2>
          <div class="model-center-source-row">
            <div class="model-center-source-mark model-center-source-mark--cloud" aria-hidden="true">
              <LegacyIcon name="providers" size="small" />
            </div>
            <div class="model-center-source-copy">
              <strong>{language.t("settings.modelCenter.sources.cloud")}</strong>
              <span>
                {connectedCloud().length > 0
                  ? language.t("settings.modelCenter.sources.cloudConnected", { count: connectedCloud().length })
                  : language.t("settings.modelCenter.sources.cloudDescription")}
              </span>
            </div>
            <ButtonV2 size="normal" variant="ghost-muted" onClick={props.onOpenProviders}>
              {language.t("settings.modelCenter.sources.manageCloud")}
            </ButtonV2>
          </div>

          <Show
            when={(profiles()?.length ?? 0) > 0}
            fallback={
              <div class="model-center-managed-empty">
                <span>{language.t("settings.modelCenter.sources.managedEmpty")}</span>
                <ButtonV2 size="normal" variant="ghost-muted" icon="plus" onClick={() => open()}>
                  {language.t("settings.modelCenter.sources.addFirst")}
                </ButtonV2>
              </div>
            }
          >
            <For each={profiles()}>
              {(profile) => (
                <div class="model-center-source-row group">
                  <div class="model-center-source-mark" aria-hidden="true">
                    <LegacyIcon name={profile.kind === "openai-compatible" ? "providers" : "server"} size="small" />
                  </div>
                  <div class="model-center-source-copy">
                    <div class="model-center-source-title">
                      <strong>{profile.name}</strong>
                      <ModelCapabilityStatus classification={profile.test?.classification} />
                    </div>
                    <span>
                      {language.t(KIND_LABELS[profile.kind])} / {host(profile.baseURL)} / {profile.models.length}{" "}
                      {language.t("settings.modelCenter.sources.modelsUnit")}
                    </span>
                    <span>
                      {profile.hasApiKey
                        ? language.t("settings.modelCenter.sources.credentialSaved")
                        : language.t("settings.modelCenter.sources.noCredential")}
                      {" / "}
                      {testedAt(profile)}
                    </span>
                  </div>
                  <div class="model-center-source-actions">
                    <IconButtonV2
                      type="button"
                      size="normal"
                      variant="ghost-muted"
                      aria-label={language.t("settings.modelCenter.action.editSource", { name: profile.name })}
                      title={language.t("common.edit")}
                      icon={<Icon name="edit" />}
                      onClick={() => open({ profile })}
                    />
                    <IconButtonV2
                      type="button"
                      size="normal"
                      variant="ghost-muted"
                      aria-label={language.t("settings.modelCenter.action.deleteSource", { name: profile.name })}
                      title={language.t("common.delete")}
                      icon={<LegacyIcon name="trash" size="small" />}
                      onClick={() => remove(profile)}
                    />
                  </div>
                </div>
              )}
            </For>
          </Show>
        </SettingsListV2>
      </section>
    </div>
  )
}

const DialogDeleteModelProfile: Component<{
  profile: ProductProviderProfile
  remove: (profileID: string) => Promise<void>
  onChanged: () => void | Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [removing, setRemoving] = createSignal(false)

  const remove = async () => {
    if (removing()) return
    setRemoving(true)
    await props
      .remove(props.profile.id)
      .then(async () => {
        await props.onChanged()
        dialog.close()
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setRemoving(false))
  }

  return (
    <Dialog fit class="model-center-delete-dialog">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("settings.modelCenter.delete.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="model-center-delete-body">
        {language.t("settings.modelCenter.delete.confirm", { name: props.profile.name })}
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={removing()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" disabled={removing()} onClick={() => void remove()}>
          {removing() ? language.t("settings.modelCenter.progress.deleting") : language.t("common.delete")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

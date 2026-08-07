import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import type { ProductProviderKind, ProductProviderProfile } from "@/product/model-center"
import { showToast } from "@/utils/toast"
import { createModelProfileFormController, type ModelProfileOperations } from "./model-center-controller"
import { ModelCapabilityStatus } from "./model-capability-status"
import { createModelDiscoveryCoordinator, modelDiscoveryPresentation } from "./model-discovery-presentation"

const KINDS: ProductProviderKind[] = ["openai-compatible", "ollama", "lm-studio", "custom-local"]

const KIND_LABELS = {
  "openai-compatible": "settings.modelCenter.kind.private",
  ollama: "settings.modelCenter.kind.ollama",
  "lm-studio": "settings.modelCenter.kind.lmStudio",
  "custom-local": "settings.modelCenter.kind.customLocal",
} as const

export const DialogModelProfile: Component<{
  operations: ModelProfileOperations
  profile?: ProductProviderProfile
  initialKind?: ProductProviderKind
  detectOnOpen?: boolean
  onChanged: () => void | Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const form = createModelProfileFormController({ operations: props.operations, profile: props.profile })
  const [manualID, setManualID] = createSignal("")
  const [advanced, setAdvanced] = createSignal(false)
  let advancedSection: HTMLElement | undefined
  let discoveryStatus: HTMLDivElement | undefined

  const applyKind = (kind: ProductProviderKind) => {
    form.setKind(kind)
    form.setField("name", language.t(KIND_LABELS[kind]))
  }

  onMount(() => {
    if (!props.profile) applyKind(props.initialKind ?? "openai-compatible")
    if (props.detectOnOpen) void form.detectLocal().catch(() => undefined)
  })
  onCleanup(() => form.cancel())

  const busy = () => form.state.saving || form.state.deleting
  const title = () =>
    form.state.mode === "edit"
      ? language.t("settings.modelCenter.dialog.edit")
      : language.t("settings.modelCenter.dialog.add")

  const addManual = () => {
    form.addManualModel(manualID())
    setManualID("")
  }

  const discover = createModelDiscoveryCoordinator({
    discovering: () => form.state.discovering,
    hasFeedback: () => form.state.discoveryFeedback !== undefined,
    schedule: (callback) => requestAnimationFrame(callback),
    scroll: () => discoveryStatus?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
  })

  const discoveryPresentation = () => modelDiscoveryPresentation(form.state.discovering, form.state.discoveryFeedback)

  const toggleAdvanced = () => {
    const next = !advanced()
    setAdvanced(next)
    if (!next) return
    requestAnimationFrame(() => advancedSection?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }

  const save = async () => {
    await form
      .save()
      .then(async (saved) => {
        await props.onChanged()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.modelCenter.toast.saved", { name: saved.name }),
        })
        dialog.close()
      })
      .catch(() => undefined)
  }

  const remove = async () => {
    await form
      .confirmDelete()
      .then(async () => {
        await props.onChanged()
        dialog.close()
      })
      .catch(() => undefined)
  }

  const selectDefault = async () => {
    await form
      .selectDefault()
      .then(async () => {
        await props.onChanged()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.modelCenter.toast.defaultChanged"),
        })
      })
      .catch(() => undefined)
  }

  return (
    <Dialog size="large" class="model-profile-dialog">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{title()}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="model-profile-dialog-body">
        <div class="model-profile-form">
          <Show when={form.state.mode === "create"}>
            <fieldset class="model-profile-fieldset">
              <legend>{language.t("settings.modelCenter.field.kind")}</legend>
              <div class="model-profile-kind-control">
                <For each={KINDS}>
                  {(kind) => (
                    <button
                      type="button"
                      aria-pressed={form.state.kind === kind}
                      disabled={busy()}
                      onClick={() => applyKind(kind)}
                    >
                      {language.t(KIND_LABELS[kind])}
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
          </Show>

          <Show when={props.detectOnOpen || form.state.localCandidates.length > 0}>
            <section class="model-profile-detected" aria-busy={form.state.detecting}>
              <div class="model-profile-section-heading">
                <span>{language.t("settings.modelCenter.detect.title")}</span>
                <ButtonV2
                  size="small"
                  variant="ghost-muted"
                  icon="reset"
                  disabled={form.state.detecting || busy()}
                  onClick={() => void form.detectLocal().catch(() => undefined)}
                >
                  {form.state.detecting
                    ? language.t("settings.modelCenter.progress.detecting")
                    : language.t("settings.modelCenter.action.detect")}
                </ButtonV2>
              </div>
              <Show
                when={form.state.localCandidates.length > 0}
                fallback={<p>{language.t("settings.modelCenter.detect.none")}</p>}
              >
                <div class="model-profile-candidate-list">
                  <For each={form.state.localCandidates}>
                    {(candidate) => (
                      <button
                        type="button"
                        disabled={!candidate.available || busy()}
                        data-selected={form.state.kind === candidate.kind && form.state.baseURL === candidate.baseURL}
                        onClick={() => form.applyLocalCandidate(candidate)}
                      >
                        <span>{candidate.name}</span>
                        <small>
                          {candidate.available
                            ? language.t("settings.modelCenter.detect.models", { count: candidate.models.length })
                            : language.t("settings.modelCenter.detect.unavailable")}
                        </small>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </Show>

          <div class="model-profile-grid">
            <label class="model-profile-field">
              <span>{language.t("settings.modelCenter.field.name")}</span>
              <TextInputV2
                appearance="large"
                value={form.state.name}
                autofocus
                disabled={busy()}
                onInput={(event) => form.setField("name", event.currentTarget.value)}
              />
            </label>
            <label class="model-profile-field model-profile-field--wide">
              <span>{language.t("settings.modelCenter.field.baseURL")}</span>
              <TextInputV2
                appearance="large"
                value={form.state.baseURL}
                disabled={busy()}
                spellcheck={false}
                onInput={(event) => form.setField("baseURL", event.currentTarget.value)}
              />
            </label>
            <label class="model-profile-field model-profile-field--wide">
              <span>{language.t("settings.modelCenter.field.apiKey")}</span>
              <TextInputV2
                type="password"
                appearance="large"
                value={form.apiKeyValue()}
                placeholder={
                  form.state.apiKeyPresent
                    ? language.t("settings.modelCenter.field.apiKeySaved")
                    : language.t("settings.modelCenter.field.apiKeyOptional")
                }
                disabled={busy()}
                autocomplete="new-password"
                onInput={(event) => form.setApiKey(event.currentTarget.value)}
              />
              <small>{language.t("settings.modelCenter.field.apiKeyDescription")}</small>
            </label>
          </div>

          <section class="model-profile-models">
            <div class="model-profile-section-heading">
              <span>{language.t("settings.modelCenter.models.title")}</span>
              <ButtonV2
                size="small"
                variant="neutral"
                icon="reset"
                disabled={form.state.discovering || busy()}
                onClick={() => void discover(() => form.discover())}
              >
                {form.state.discovering
                  ? language.t("settings.modelCenter.progress.discovering")
                  : language.t("settings.modelCenter.action.discover")}
              </ButtonV2>
            </div>
            <div class="model-profile-manual-model">
              <TextInputV2
                value={manualID()}
                placeholder={language.t("settings.modelCenter.models.manualPlaceholder")}
                disabled={busy()}
                spellcheck={false}
                onInput={(event) => setManualID(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.isComposing) return
                  event.preventDefault()
                  addManual()
                }}
              />
              <IconButtonV2
                type="button"
                size="normal"
                variant="neutral"
                aria-label={language.t("settings.modelCenter.models.addManual")}
                title={language.t("settings.modelCenter.models.addManual")}
                disabled={!manualID().trim() || busy()}
                icon={<Icon name="plus" />}
                onClick={addManual}
              />
            </div>
            <Show when={discoveryPresentation()}>
              {(status) => (
                <div
                  ref={discoveryStatus}
                  class="model-profile-discovery-status"
                  data-tone={status().tone}
                  role="status"
                  aria-live={status().live}
                  aria-atomic="true"
                >
                  {language.t(status().key, status().params)}
                </div>
              )}
            </Show>
            <Show
              when={form.state.models.length > 0}
              fallback={<div class="model-profile-empty">{language.t("settings.modelCenter.models.empty")}</div>}
            >
              <TextInputV2
                type="search"
                value={form.state.modelQuery}
                placeholder={language.t("settings.modelCenter.discovery.search")}
                aria-label={language.t("settings.modelCenter.discovery.search")}
                disabled={busy()}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                onInput={(event) => form.setModelQuery(event.currentTarget.value)}
              />
              <Show
                when={form.filteredModels().length > 0}
                fallback={
                  <div class="model-profile-empty">{language.t("settings.modelCenter.discovery.searchEmpty")}</div>
                }
              >
                <div class="model-profile-model-list">
                  <For each={form.filteredModels()}>
                    {(model) => (
                      <label class="model-profile-model-row">
                        <input
                          type="radio"
                          name="profile-model"
                          checked={form.state.selectedModelID === model.id}
                          disabled={busy()}
                          onChange={() => form.selectModel(model.id)}
                        />
                        <span>
                          <strong>{model.name}</strong>
                          <small>{model.id}</small>
                        </span>
                        <IconButtonV2
                          type="button"
                          size="small"
                          variant="ghost-muted"
                          aria-label={language.t("settings.modelCenter.models.remove", { model: model.name })}
                          title={language.t("common.delete")}
                          icon={<Icon name="close" />}
                          onClick={(event) => {
                            event.preventDefault()
                            form.removeModel(model.id)
                          }}
                        />
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
            <div class="model-profile-test-row" aria-busy={form.state.testing}>
              <div>
                <ModelCapabilityStatus classification={form.state.report?.classification} />
                <Show when={form.state.report}>
                  {(report) => (
                    <span class="model-profile-checks">
                      {language.t("settings.modelCenter.test.checks", {
                        streaming: report().checks.streaming ? "OK" : "--",
                        tools: report().checks.toolCalling ? "OK" : "--",
                      })}
                    </span>
                  )}
                </Show>
              </div>
              <ButtonV2
                size="normal"
                variant="neutral"
                disabled={!form.state.selectedModelID || form.state.testing || busy()}
                onClick={() => void form.test().catch(() => undefined)}
              >
                {form.state.testing
                  ? language.t("settings.modelCenter.progress.testing")
                  : language.t("settings.modelCenter.action.test")}
              </ButtonV2>
            </div>
          </section>

          <section class="model-profile-advanced" ref={advancedSection}>
            <button type="button" aria-expanded={advanced()} onClick={toggleAdvanced}>
              <Icon name="chevron-down" classList={{ "model-profile-chevron--open": advanced() }} />
              {language.t("settings.modelCenter.advanced.title")}
            </button>
            <Show when={advanced()}>
              <div class="model-profile-advanced-body">
                <div class="model-profile-section-heading">
                  <span>{language.t("settings.modelCenter.headers.title")}</span>
                  <ButtonV2 size="small" variant="ghost-muted" icon="plus" onClick={() => form.addHeader()}>
                    {language.t("settings.modelCenter.headers.add")}
                  </ButtonV2>
                </div>
                <For each={form.state.headers}>
                  {(header, index) => (
                    <div class="model-profile-header-row">
                      <TextInputV2
                        value={header.name}
                        placeholder={language.t("settings.modelCenter.headers.name")}
                        spellcheck={false}
                        onInput={(event) => form.setHeader(index(), { name: event.currentTarget.value })}
                      />
                      <TextInputV2
                        type={header.sensitive ? "password" : "text"}
                        value={form.headerValue(index())}
                        placeholder={
                          header.sensitive && header.hasValue
                            ? language.t("settings.modelCenter.headers.valueSaved")
                            : language.t("settings.modelCenter.headers.value")
                        }
                        onInput={(event) => form.setHeader(index(), { value: event.currentTarget.value })}
                      />
                      <Switch
                        checked={header.sensitive}
                        onChange={(sensitive) => form.setHeader(index(), { sensitive })}
                      >
                        {language.t("settings.modelCenter.headers.sensitive")}
                      </Switch>
                      <IconButtonV2
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        aria-label={language.t("settings.modelCenter.headers.remove")}
                        icon={<Icon name="close" />}
                        onClick={() => form.removeHeader(index())}
                      />
                    </div>
                  )}
                </For>

                <div class="model-profile-number-grid">
                  <label class="model-profile-field">
                    <span>{language.t("settings.modelCenter.advanced.timeout")}</span>
                    <TextInputV2
                      type="number"
                      numeric
                      value={String(form.state.settings.timeoutMs)}
                      onInput={(event) => form.setSetting("timeoutMs", Number(event.currentTarget.value))}
                    />
                  </label>
                  <label class="model-profile-field">
                    <span>{language.t("settings.modelCenter.advanced.context")}</span>
                    <TextInputV2
                      type="number"
                      numeric
                      value={String(form.state.settings.contextLimit)}
                      onInput={(event) => form.setSetting("contextLimit", Number(event.currentTarget.value))}
                    />
                  </label>
                  <label class="model-profile-field">
                    <span>{language.t("settings.modelCenter.advanced.output")}</span>
                    <TextInputV2
                      type="number"
                      numeric
                      value={String(form.state.settings.outputLimit)}
                      onInput={(event) => form.setSetting("outputLimit", Number(event.currentTarget.value))}
                    />
                  </label>
                </div>
                <div class="model-profile-transport-grid">
                  <label class="model-profile-field">
                    <span>{language.t("settings.modelCenter.advanced.proxy")}</span>
                    <TextInputV2
                      value=""
                      disabled
                      placeholder={language.t("settings.modelCenter.advanced.notSupported")}
                    />
                  </label>
                  <div class="model-profile-tls-row">
                    <span>{language.t("settings.modelCenter.advanced.insecureTls")}</span>
                    <Switch checked={false} disabled hideLabel>
                      {language.t("settings.modelCenter.advanced.insecureTls")}
                    </Switch>
                  </div>
                  <p>{language.t("settings.modelCenter.advanced.transportLimitation")}</p>
                </div>
              </div>
            </Show>
          </section>

          <Show when={form.state.error || form.state.diagnostic}>
            <div class="model-profile-feedback" role="status">
              {form.state.error ?? form.state.diagnostic}
            </div>
          </Show>

          <Show when={form.state.deleteConfirmation}>
            <div class="model-profile-delete-confirmation" role="alertdialog">
              <div>
                <strong>{language.t("settings.modelCenter.delete.title")}</strong>
                <span>{language.t("settings.modelCenter.delete.confirm", { name: form.state.name })}</span>
              </div>
              <ButtonV2 variant="ghost-muted" disabled={form.state.deleting} onClick={() => form.cancelDelete()}>
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2 variant="danger" disabled={form.state.deleting} onClick={() => void remove()}>
                {form.state.deleting
                  ? language.t("settings.modelCenter.progress.deleting")
                  : language.t("common.delete")}
              </ButtonV2>
            </div>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Show when={form.state.mode === "edit"}>
          <ButtonV2 variant="danger" disabled={busy()} onClick={() => form.requestDelete()}>
            {language.t("common.delete")}
          </ButtonV2>
        </Show>
        <span class="model-profile-footer-spacer" />
        <Show when={form.state.mode === "edit"}>
          <ButtonV2 variant="neutral" disabled={!form.canSelectDefault()} onClick={() => void selectDefault()}>
            {language.t("settings.modelCenter.action.makeDefault")}
          </ButtonV2>
        </Show>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!form.canSave()} onClick={() => void save()}>
          {form.state.saving ? language.t("settings.modelCenter.progress.saving") : language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, createSignal, type Component } from "solid-js"
import { normalizePersonalizationInstructions, useSettings } from "@/context/settings"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

export const SettingsPersonalizationV2: Component = () => {
  const settings = useSettings()
  const language = useLanguage()
  const dialog = useDialog()
  const [draft, setDraft] = createSignal(settings.personalization.instructions())

  createEffect(() => setDraft(settings.personalization.instructions()))

  const normalized = createMemo(() => normalizePersonalizationInstructions(draft()))
  const changed = createMemo(() => normalized() !== settings.personalization.instructions())
  const hasCustomInstructions = createMemo(
    () => normalized().length > 0 || settings.personalization.instructions().length > 0,
  )

  const save = () => {
    settings.personalization.setInstructions(draft())
    setDraft(normalized())
    showToast({ title: language.t("settings.personalization.save.success") })
  }

  const restore = () => {
    if (!hasCustomInstructions()) return
    void dialog.push(() => (
      <DialogRestorePersonalization
        onCancel={() => dialog.close()}
        onRestore={() => {
          settings.personalization.setInstructions("")
          setDraft("")
          dialog.close()
          showToast({ title: language.t("settings.personalization.restore.success") })
        }}
      />
    ))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.personalization.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <section class="settings-v2-personalization">
          <div class="settings-v2-personalization-copy">
            <label for="personalization-instructions" class="settings-v2-personalization-label">
              {language.t("settings.personalization.field.label")}
            </label>
            <p class="settings-v2-personalization-description">
              {language.t("settings.personalization.field.description")}
            </p>
          </div>
          <TextareaV2
            id="personalization-instructions"
            value={draft()}
            rows={12}
            placeholder={language.t("settings.personalization.field.placeholder")}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <div class="settings-v2-personalization-actions">
            <ButtonV2 variant="neutral" disabled={!hasCustomInstructions()} onClick={restore}>
              {language.t("settings.personalization.restore.action")}
            </ButtonV2>
            <ButtonV2 variant="contrast" disabled={!changed()} onClick={save}>
              {language.t("common.save")}
            </ButtonV2>
          </div>
        </section>
      </div>
    </>
  )
}

const DialogRestorePersonalization: Component<{ onCancel: () => void; onRestore: () => void }> = (props) => {
  const language = useLanguage()
  return (
    <Dialog fit class="settings-v2-personalization-restore-dialog">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("settings.personalization.restore.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-personalization-restore-body">
        {language.t("settings.personalization.restore.confirm")}
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={props.onCancel}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" onClick={props.onRestore}>
          {language.t("settings.personalization.restore.action")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

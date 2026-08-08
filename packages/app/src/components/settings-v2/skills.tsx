import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { Skill } from "@opencode-ai/schema/skill"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { filterSkills, isPending, scopeKey, sourceKey, statusKey, type SkillStatusFilter } from "./skills-controller"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const FILTERS = ["all", "active", "disabled", "shadowed"] as const

export const SettingsSkillsV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const [query, setQuery] = createSignal("")
  const [status, setStatus] = createSignal<SkillStatusFilter>("all")
  const [pendingID, setPendingID] = createSignal<Skill.ManagementID>()
  const queryKey = () => [serverSDK().scope, props.directory, "skill-management"] as const
  const skills = useQuery(() => ({
    queryKey: queryKey(),
    enabled: !!props.directory,
    retry: false,
    queryFn: () => serverSDK().skillManagement.list(props.directory!),
  }))
  const items = createMemo(() => skills.data ?? [])
  const filtered = createMemo(() => filterSkills(items(), { query: query(), status: status() }))

  const setEnabled = async (item: Skill.ManagementInfo, enabled: boolean) => {
    if (!props.directory || pendingID()) return false
    const directory = props.directory
    const key = queryKey()
    setPendingID(item.id)
    return serverSDK()
      .skillManagement.setEnabled(directory, item.id, enabled)
      .then((next) => {
        queryClient.setQueryData(key, next)
        showToast({
          title: language.t(enabled ? "settings.skills.enable.success" : "settings.skills.disable.success", {
            name: item.name,
          }),
        })
        return true
      })
      .catch(() => {
        showToast({
          title: language.t("common.requestFailed"),
          description: language.t(enabled ? "settings.skills.enable.failure" : "settings.skills.disable.failure", {
            name: item.name,
          }),
        })
        return false
      })
      .finally(() => setPendingID(undefined))
  }

  const remove = async (item: Skill.ManagementInfo) => {
    if (!props.directory || pendingID()) return false
    const directory = props.directory
    const key = queryKey()
    setPendingID(item.id)
    return serverSDK()
      .skillManagement.remove(directory, item.id)
      .then((next) => {
        queryClient.setQueryData(key, next)
        showToast({ title: language.t("settings.skills.delete.success", { name: item.name }) })
        return true
      })
      .catch(() => {
        showToast({
          title: language.t("common.requestFailed"),
          description: language.t("settings.skills.delete.failure", { name: item.name }),
        })
        return false
      })
      .finally(() => setPendingID(undefined))
  }

  const confirmRemove = (item: Skill.ManagementInfo) => {
    if (!item.deleteTarget) return
    void dialog.push(() => (
      <DialogDeleteSkill
        item={item}
        pending={() => isPending(pendingID(), item)}
        remove={() => remove(item)}
      />
    ))
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked settings-v2-skills-header">
        <div class="settings-v2-tab-header-row settings-v2-skills-heading">
          <h2 class="settings-v2-tab-title">{language.t("settings.skills.title")}</h2>
          <span class="settings-v2-skills-count">{language.t("settings.skills.count", { count: items().length })}</span>
        </div>
        <Show when={items().length > 1}>
          <div class="settings-v2-tab-search settings-v2-skills-search">
            <TextInputV2
              type="search"
              appearance="base"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={language.t("settings.skills.search")}
              aria-label={language.t("settings.skills.search")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </div>
        </Show>
        <SegmentedControlV2
          class="settings-v2-skills-filters"
          value={status()}
          aria-label={language.t("settings.skills.filter.label")}
          onChange={(value) => value && setStatus(value as SkillStatusFilter)}
        >
          <For each={FILTERS}>
            {(filter) => (
              <SegmentedControlItemV2 value={filter}>
                {language.t(`settings.skills.filter.${filter}`)}
              </SegmentedControlItemV2>
            )}
          </For>
        </SegmentedControlV2>
      </div>

      <div class="settings-v2-tab-body settings-v2-skills">
        <SettingsListV2>
          <Show when={props.directory} fallback={<SkillState text={language.t("settings.skills.locationRequired")} />}>
            <Show when={!skills.isPending} fallback={<SkillState text={language.t("settings.skills.loading")} />}>
              <Show when={!skills.isError} fallback={<SkillState text={language.t("settings.skills.load.failure")} />}>
                <Show when={items().length > 0} fallback={<SkillState text={language.t("settings.skills.empty")} />}>
                  <Show when={filtered().length > 0} fallback={<SkillState text={language.t("settings.skills.noMatches")} />}>
                    <For each={filtered()}>
                      {(item) => {
                        const source = () => language.t(sourceKey(item))
                        const scope = () => language.t(scopeKey(item))
                        const state = () => language.t(statusKey(item))
                        const location = () => (item.source.type === "url" ? item.source.value : item.location)
                        const pending = () => isPending(pendingID(), item)
                        return (
                          <div class="settings-v2-skills-row">
                            <div class="settings-v2-skills-copy">
                              <div class="settings-v2-skills-name">{item.name}</div>
                              <Show when={item.description}>
                                {(description) => <div class="settings-v2-skills-description">{description()}</div>}
                              </Show>
                              <div class="settings-v2-skills-meta">
                                <Tag title={item.source.value}>
                                  <span class="sr-only">
                                    {language.t("settings.skills.source.label", { value: source() })}
                                  </span>
                                  <span aria-hidden="true">{source()}</span>
                                </Tag>
                                <Tag>
                                  <span class="sr-only">
                                    {language.t("settings.skills.scope.label", { value: scope() })}
                                  </span>
                                  <span aria-hidden="true">{scope()}</span>
                                </Tag>
                                <Tag variant={item.status === "active" ? "accent" : "neutral"}>
                                  <span class="sr-only">
                                    {language.t("settings.skills.status.label", { value: state() })}
                                  </span>
                                  <span aria-hidden="true">{state()}</span>
                                </Tag>
                              </div>
                              <div
                                class="settings-v2-skills-location"
                                title={location()}
                              >
                                <span class="sr-only">
                                  {language.t("settings.skills.path.label", { value: location() })}
                                </span>
                                <span aria-hidden="true">{location()}</span>
                              </div>
                            </div>
                            <div class="settings-v2-skills-actions">
                              <div class="settings-v2-skills-action">
                                <Switch
                                  checked={item.enabled}
                                  disabled={pending()}
                                  hideLabel
                                  onChange={(enabled) => void setEnabled(item, enabled)}
                                >
                                  {language.t(
                                    item.enabled ? "settings.skills.disable.label" : "settings.skills.enable.label",
                                    { name: item.name },
                                  )}
                                </Switch>
                              </div>
                              <div class="settings-v2-skills-action">
                                <Show when={item.deletable}>
                                  <IconButtonV2
                                    type="button"
                                    size="small"
                                    variant="ghost-muted"
                                    disabled={pending()}
                                    title={language.t("settings.skills.delete.action", { name: item.name })}
                                    aria-label={language.t("settings.skills.delete.action", { name: item.name })}
                                    icon={<Icon name="trash" size="small" />}
                                    onClick={() => confirmRemove(item)}
                                  />
                                </Show>
                              </div>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </Show>
                </Show>
              </Show>
            </Show>
          </Show>
        </SettingsListV2>
      </div>
    </>
  )
}

const SkillState: Component<{ text: string }> = (props) => <div class="settings-v2-skills-state">{props.text}</div>

const DialogDeleteSkill: Component<{
  item: Skill.ManagementInfo
  pending: () => boolean
  remove: () => Promise<boolean>
}> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const remove = async () => {
    if (props.pending()) return
    if (await props.remove()) dialog.close()
  }
  return (
    <Dialog fit class="settings-v2-skill-delete-dialog">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("settings.skills.delete.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-skill-delete-body">
        {language.t("settings.skills.delete.confirm", {
          name: props.item.name,
          path: props.item.deleteTarget ?? props.item.location,
        })}
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={props.pending()} onClick={() => dialog.close()}>
          {language.t("settings.skills.delete.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" disabled={props.pending()} onClick={() => void remove()}>
          {props.pending()
            ? language.t("settings.skills.delete.deleting")
            : language.t("settings.skills.delete.actionButton")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

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
import { type Component, createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { type ServerSDK, useServerSDK } from "@/context/server-sdk"
import { isSkillManagementNotFound, type SkillManagementApi } from "@/utils/skill-management-api"
import { showToast } from "@/utils/toast"
import {
  blockedKey,
  createSkillRefreshQueue,
  filterSkills,
  isPending,
  scopeKey,
  sourceKey,
  statusKey,
  type SkillStatusFilter,
} from "./skills-controller"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const FILTERS = ["all", "active", "disabled", "shadowed"] as const
type SkillQueryKey = readonly [ServerSDK["scope"], string, "skill-management"]
type DeleteSnapshot = {
  item: Skill.ManagementInfo
  directory: string
  sdk: ServerSDK
  api: SkillManagementApi
  queryKey: SkillQueryKey
  valid: boolean
  dialogID?: string
}

export const SettingsSkillsV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    query: "",
    status: "all" as SkillStatusFilter,
    pendingIDs: new Set<Skill.ManagementID>() as ReadonlySet<Skill.ManagementID>,
  })
  const queryKey = () => [serverSDK().scope, props.directory, "skill-management"] as const
  const skills = useQuery(() => ({
    queryKey: queryKey(),
    enabled: !!props.directory,
    retry: false,
    queryFn: () => serverSDK().skillManagement.list(props.directory!),
  }))
  const items = createMemo(() => skills.data ?? [])
  const filtered = createMemo(() => filterSkills(items(), { query: state.query, status: state.status }))
  const refreshSkills = createSkillRefreshQueue((key: ReturnType<typeof queryKey>) =>
    queryClient.refetchQueries(
      { queryKey: key, exact: true, type: "active" },
      { throwOnError: true, cancelRefetch: true },
    ),
  )
  const begin = (id: Skill.ManagementID) => {
    if (state.pendingIDs.has(id)) return false
    setState("pendingIDs", new Set([...state.pendingIDs, id]))
    return true
  }
  const end = (id: Skill.ManagementID) =>
    setState("pendingIDs", new Set([...state.pendingIDs].filter((value) => value !== id)))

  const mutationContext = () => {
    const directory = props.directory
    if (!directory) return
    const sdk = serverSDK()
    return {
      directory,
      sdk,
      api: sdk.skillManagement,
      queryKey: [sdk.scope, directory, "skill-management"] as const,
    }
  }

  const setEnabled = async (item: Skill.ManagementInfo, enabled: boolean) => {
    const context = mutationContext()
    if (!context || !begin(item.id)) return false
    try {
      const next = await context.api.setEnabled(context.directory, item.id, enabled)
      queryClient.setQueryData(context.queryKey, next)
      await refreshSkills(context.queryKey)
      showToast({
        title: language.t(enabled ? "settings.skills.enable.success" : "settings.skills.disable.success", {
          name: item.name,
        }),
      })
      return true
    } catch (error) {
      if (isSkillManagementNotFound(error)) await refreshSkills(context.queryKey).catch(() => undefined)
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t(enabled ? "settings.skills.enable.failure" : "settings.skills.disable.failure", {
          name: item.name,
        }),
      })
      return false
    } finally {
      end(item.id)
    }
  }

  const remove = async (snapshot: DeleteSnapshot) => {
    if (!snapshot.valid || !begin(snapshot.item.id)) return false
    try {
      const next = await snapshot.api.remove(snapshot.directory, snapshot.item.id)
      queryClient.setQueryData(snapshot.queryKey, next)
      await refreshSkills(snapshot.queryKey)
      showToast({ title: language.t("settings.skills.delete.success", { name: snapshot.item.name }) })
      return true
    } catch (error) {
      if (isSkillManagementNotFound(error)) await refreshSkills(snapshot.queryKey).catch(() => undefined)
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.skills.delete.failure", { name: snapshot.item.name }),
      })
      return false
    } finally {
      end(snapshot.item.id)
    }
  }

  let confirmation: DeleteSnapshot | undefined
  const closeConfirmation = (snapshot: DeleteSnapshot) => {
    if (!snapshot.valid || !snapshot.dialogID || dialog.active?.id !== snapshot.dialogID) return
    snapshot.valid = false
    dialog.close()
  }
  const confirmRemove = (item: Skill.ManagementInfo) => {
    const context = mutationContext()
    if (!item.deleteTarget || !context) return
    if (confirmation) confirmation.valid = false
    const snapshot: DeleteSnapshot = { item, valid: true, ...context }
    confirmation = snapshot
    const opened = dialog.push(
      () => (
        <DialogDeleteSkill
          snapshot={snapshot}
          valid={() => snapshot.valid && confirmation === snapshot}
          pending={() => isPending(state.pendingIDs, snapshot.item)}
          remove={() => remove(snapshot)}
          close={() => closeConfirmation(snapshot)}
        />
      ),
      () => {
        snapshot.valid = false
        if (confirmation === snapshot) confirmation = undefined
      },
    )
    void Promise.resolve(opened).then(() => {
      if (!snapshot.valid || confirmation !== snapshot) return
      snapshot.dialogID = dialog.active?.id
    })
  }

  createEffect(() => {
    const sdk = serverSDK()
    const directory = props.directory
    const snapshot = confirmation
    if (!snapshot || (snapshot.sdk === sdk && snapshot.directory === directory)) return
    if (snapshot.dialogID && dialog.active?.id === snapshot.dialogID) dialog.close()
    snapshot.valid = false
    if (confirmation === snapshot) confirmation = undefined
  })

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked settings-v2-skills-header">
        <div class="settings-v2-tab-header-row settings-v2-skills-heading">
          <h2 class="settings-v2-tab-title">{language.t("settings.skills.title")}</h2>
          <span class="settings-v2-skills-count">{language.t("settings.skills.count", { count: items().length })}</span>
        </div>
        <div class="settings-v2-tab-search settings-v2-skills-search">
          <Show
            when={items().length > 1 || state.query.trim().length > 0}
            fallback={
              <div
                class="settings-v2-skills-search-placeholder"
                data-loading={props.directory && skills.isPending ? "" : undefined}
                aria-hidden="true"
              />
            }
          >
            <TextInputV2
              type="search"
              appearance="base"
              value={state.query}
              onInput={(event) => setState("query", event.currentTarget.value)}
              placeholder={language.t("settings.skills.search")}
              aria-label={language.t("settings.skills.search")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </Show>
        </div>
        <div class="settings-v2-skills-filters-scroll">
          <SegmentedControlV2
            class="settings-v2-skills-filters"
            value={state.status}
            aria-label={language.t("settings.skills.filter.label")}
            onChange={(value) => value && setState("status", value as SkillStatusFilter)}
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
      </div>

      <div class="settings-v2-tab-body settings-v2-skills">
        <SettingsListV2>
          <Show when={props.directory} fallback={<SkillState text={language.t("settings.skills.locationRequired")} />}>
            <Show when={!skills.isPending} fallback={<SkillState text={language.t("settings.skills.loading")} />}>
              <Show
                when={!skills.isError || items().length > 0}
                fallback={<SkillState text={language.t("settings.skills.load.failure")} />}
              >
                <Show when={items().length > 0} fallback={<SkillState text={language.t("settings.skills.empty")} />}>
                  <Show when={filtered().length > 0} fallback={<SkillState text={language.t("settings.skills.noMatches")} />}>
                    <For each={filtered()}>
                      {(item) => {
                        const source = () => language.t(sourceKey(item))
                        const scope = () => language.t(scopeKey(item))
                        const statusLabel = () => language.t(statusKey(item))
                        const blocked = () => {
                          const key = blockedKey(item)
                          return key ? language.t(key) : undefined
                        }
                        const location = () => (item.source.type === "url" ? item.source.value : item.location)
                        const pending = () => isPending(state.pendingIDs, item)
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
                                    {language.t("settings.skills.status.label", { value: statusLabel() })}
                                  </span>
                                  <span aria-hidden="true">{statusLabel()}</span>
                                </Tag>
                                <Show when={blocked()}>
                                  {(reason) => (
                                    <span class="settings-v2-skills-blocked" title={reason()}>
                                      {reason()}
                                    </span>
                                  )}
                                </Show>
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
  snapshot: DeleteSnapshot
  valid: () => boolean
  pending: () => boolean
  remove: () => Promise<boolean>
  close: () => void
}> = (props) => {
  const language = useLanguage()
  const remove = async () => {
    if (props.pending() || !props.valid()) return
    if (await props.remove()) props.close()
  }
  return (
    <Dialog fit class="settings-v2-skill-delete-dialog">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("settings.skills.delete.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-skill-delete-body">
        {language.t("settings.skills.delete.confirm", {
          name: props.snapshot.item.name,
          path: props.snapshot.item.deleteTarget ?? props.snapshot.item.location,
        })}
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={props.pending()} onClick={() => props.close()}>
          {language.t("settings.skills.delete.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" disabled={props.pending() || !props.valid()} onClick={() => void remove()}>
          {props.pending()
            ? language.t("settings.skills.delete.deleting")
            : language.t("settings.skills.delete.actionButton")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

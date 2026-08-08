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
import { type Component, createEffect, createMemo, For, onCleanup, Show } from "solid-js"
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
  skillPendingKey,
  scopeKey,
  sourceKey,
  statusKey,
  type SkillStatusFilter,
} from "./skills-controller"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const FILTERS = ["all", "active", "disabled", "shadowed"] as const
type SkillQueryKey = readonly [ServerSDK["scope"], string, "skill-management"]
type MutationContext = {
  directory: string
  scope: ServerSDK["scope"]
  api: SkillManagementApi
  queryKey: SkillQueryKey
}
type DeleteSnapshot = MutationContext & {
  item: Skill.ManagementInfo
  pendingKey: string
  token: number
  valid: boolean
  dialogID?: string
}

export const SettingsSkillsV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const [state, setState] = createStore<{
    query: string
    status: SkillStatusFilter
    pendingKeys: ReadonlySet<string>
    confirmation?: DeleteSnapshot
  }>({
    query: "",
    status: "all",
    pendingKeys: new Set<string>(),
  })
  let mounted = true
  let confirmationToken = 0
  onCleanup(() => {
    mounted = false
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
  const refreshSkills = createSkillRefreshQueue(async (context: MutationContext) => {
    const result = await context.api.list(context.directory)
    queryClient.setQueryData(context.queryKey, result)
  })
  const begin = (key: string) => {
    if (state.pendingKeys.has(key)) return false
    setState("pendingKeys", new Set([...state.pendingKeys, key]))
    return true
  }
  const end = (key: string) => {
    if (!mounted) return
    setState("pendingKeys", new Set([...state.pendingKeys].filter((value) => value !== key)))
  }

  const mutationContext = () => {
    const directory = props.directory
    if (!directory) return
    const sdk = serverSDK()
    return {
      directory,
      scope: sdk.scope,
      api: sdk.skillManagement,
      queryKey: [sdk.scope, directory, "skill-management"] as const,
    }
  }

  const setEnabled = async (item: Skill.ManagementInfo, enabled: boolean) => {
    const context = mutationContext()
    if (!context) return false
    const pendingKey = skillPendingKey(context.scope, context.directory, item.id)
    if (!begin(pendingKey)) return false
    try {
      const next = await context.api.setEnabled(context.directory, item.id, enabled)
      queryClient.setQueryData(context.queryKey, next)
      await refreshSkills(context)
      showToast({
        title: language.t(enabled ? "settings.skills.enable.success" : "settings.skills.disable.success", {
          name: item.name,
        }),
      })
      return true
    } catch (error) {
      if (isSkillManagementNotFound(error)) await refreshSkills(context).catch(() => undefined)
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t(enabled ? "settings.skills.enable.failure" : "settings.skills.disable.failure", {
          name: item.name,
        }),
      })
      return false
    } finally {
      end(pendingKey)
    }
  }

  const remove = async (snapshot: DeleteSnapshot) => {
    if (!snapshot.valid || !begin(snapshot.pendingKey)) return false
    try {
      const next = await snapshot.api.remove(snapshot.directory, snapshot.item.id)
      queryClient.setQueryData(snapshot.queryKey, next)
      await refreshSkills(snapshot)
      showToast({ title: language.t("settings.skills.delete.success", { name: snapshot.item.name }) })
      return true
    } catch (error) {
      if (isSkillManagementNotFound(error)) await refreshSkills(snapshot).catch(() => undefined)
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.skills.delete.failure", { name: snapshot.item.name }),
      })
      return false
    } finally {
      end(snapshot.pendingKey)
    }
  }

  const closeConfirmation = (snapshot: DeleteSnapshot) => {
    if (!mounted || !snapshot.dialogID || dialog.active?.id !== snapshot.dialogID) return
    if (state.confirmation?.token === snapshot.token) setState("confirmation", "valid", false)
    dialog.close()
  }
  const confirmRemove = (item: Skill.ManagementInfo) => {
    const context = mutationContext()
    if (!item.deleteTarget || !context) return
    if (state.confirmation) setState("confirmation", "valid", false)
    setState("confirmation", {
      item,
      pendingKey: skillPendingKey(context.scope, context.directory, item.id),
      token: ++confirmationToken,
      valid: true,
      ...context,
    })
    const snapshot = state.confirmation
    if (!snapshot) return
    const opened = dialog.push(
      () => (
        <DialogDeleteSkill
          snapshot={snapshot}
          valid={() => snapshot.valid && state.confirmation?.token === snapshot.token}
          pending={() => isPending(state.pendingKeys, snapshot.pendingKey)}
          remove={() => remove(snapshot)}
          close={() => closeConfirmation(snapshot)}
        />
      ),
      () => {
        if (!mounted || state.confirmation?.token !== snapshot.token) return
        setState("confirmation", undefined)
      },
    )
    void Promise.resolve(opened).then(() => {
      if (!mounted || !snapshot.valid || state.confirmation?.token !== snapshot.token) return
      setState("confirmation", "dialogID", dialog.active?.id)
    })
  }

  createEffect(() => {
    const sdk = serverSDK()
    const directory = props.directory
    const snapshot = state.confirmation
    const activeID = dialog.active?.id
    if (!snapshot) return
    if (snapshot.valid && (snapshot.scope !== sdk.scope || snapshot.directory !== directory)) {
      setState("confirmation", "valid", false)
      return
    }
    if (snapshot.valid || !snapshot.dialogID || snapshot.dialogID !== activeID) return
    queueMicrotask(() => {
      if (!mounted || state.confirmation?.token !== snapshot.token) return
      if (dialog.active?.id !== snapshot.dialogID) return
      dialog.close()
    })
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
                  <Show
                    when={filtered().length > 0}
                    fallback={<SkillState text={language.t("settings.skills.noMatches")} />}
                  >
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
                        const pending = () => {
                          const directory = props.directory
                          if (!directory) return false
                          return isPending(state.pendingKeys, skillPendingKey(serverSDK().scope, directory, item.id))
                        }
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
                              <div class="settings-v2-skills-location" title={location()}>
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
        <ButtonV2 variant="neutral" onClick={() => props.close()}>
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

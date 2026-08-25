import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { type ServerSDK, useServerSDK } from "@/context/server-sdk"
import { pathKey } from "@/utils/path-key"
import { isSkillManagementNotFound, type SkillManagementApi } from "@/utils/skill-management-api"
import { showToast } from "@/utils/toast"
import {
  blockedKey,
  createSkillManagementLoader,
  createSkillRefreshLifecycle,
  createSkillRefreshQueue,
  filterSkills,
  isPending,
  mergeDeviceSkills,
  skillPendingKey,
  scopeKey,
  sourceKey,
  statusKey,
  type DeviceSkill,
  type SkillStatusFilter,
} from "./skills-controller"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const FILTERS = ["all", "active", "disabled", "shadowed"] as const
type SkillQueryKey = readonly [ServerSDK["scope"], string, "skill-management"]
type MutationContext = {
  directories: readonly string[]
  directoryKey: string
  scope: ServerSDK["scope"]
  api: SkillManagementApi
  queryKey: SkillQueryKey
}
type DeleteSnapshot = MutationContext & {
  directory: string
  item: DeviceSkill
  pendingKey: string
  token: number
  valid: boolean
  dialogID?: string
}

export const SettingsSkillsV2: Component<{
  directory?: string
  directories?: readonly string[]
  active?: boolean
}> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const [state, setState] = createStore<{
    query: string
    status: SkillStatusFilter
    pendingKeys: ReadonlySet<string>
    refreshing: boolean
    confirmation?: DeleteSnapshot
  }>({
    query: "",
    status: "all",
    pendingKeys: new Set<string>(),
    refreshing: false,
  })
  let mounted = true
  let confirmationToken = 0
  onCleanup(() => {
    mounted = false
  })
  const directories = createMemo(() => {
    const seen = new Set<string>()
    return (props.directories ?? (props.directory ? [props.directory] : [])).filter((directory) => {
      const key = pathKey(directory)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })
  const directoryKey = createMemo(() => {
    const current = directories()
    return current.length === 1 ? current[0]! : JSON.stringify(current)
  })
  const queryKey = () => [serverSDK().scope, directoryKey(), "skill-management"] as const
  const loadSkills = createSkillManagementLoader()
  const mutationContext = () => {
    const current = directories()
    if (current.length === 0) return
    const sdk = serverSDK()
    return {
      directories: current,
      directoryKey: directoryKey(),
      scope: sdk.scope,
      api: sdk.skillManagement,
      queryKey: [sdk.scope, directoryKey(), "skill-management"] as const,
    }
  }
  const loadDeviceSkills = (context: MutationContext, options?: { refresh?: boolean }) => {
    if (context.directories.length === 1) {
      const directory = context.directories[0]!
      return loadSkills(JSON.stringify([context.scope, directory]), () => context.api.list(directory, options))
    }
    return Promise.all(
      context.directories.map(async (directory) => ({
        directory,
        items: await loadSkills(JSON.stringify([context.scope, directory]), () => context.api.list(directory, options)),
      })),
    ).then(mergeDeviceSkills)
  }
  const skills = useQuery(() => ({
    queryKey: queryKey(),
    enabled: false,
    retry: false,
    queryFn: () => {
      const context = mutationContext()
      if (!context) return []
      return loadDeviceSkills(context)
    },
  }))
  const items = createMemo(() => skills.data ?? [])
  const filtered = createMemo(() => filterSkills(items(), { query: state.query, status: state.status }))
  const refreshSkills = createSkillRefreshQueue(async (context: MutationContext) => {
    queryClient.setQueryData(context.queryKey, await loadDeviceSkills(context))
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

  createEffect(() => {
    serverSDK()
    directoryKey()
    if (!(props.active ?? true) || directories().length === 0) return
    const lifecycle = createSkillRefreshLifecycle({
      refresh: () => skills.refetch({ cancelRefetch: false }),
      visible: () => document.visibilityState === "visible",
      onFocus: (listener) => {
        window.addEventListener("focus", listener)
        return () => window.removeEventListener("focus", listener)
      },
      onVisibilityChange: (listener) => {
        document.addEventListener("visibilitychange", listener)
        return () => document.removeEventListener("visibilitychange", listener)
      },
      setTimer: (listener, milliseconds) => window.setTimeout(listener, milliseconds),
      clearTimer: (timer) => window.clearTimeout(timer),
    })
    onCleanup(lifecycle.dispose)
  })

  const refreshAll = async () => {
    const context = mutationContext()
    if (!context || skills.isFetching) return
    setState("refreshing", true)
    await queryClient
      .fetchQuery({
        queryKey: context.queryKey,
        queryFn: () => loadDeviceSkills(context, { refresh: true }),
        staleTime: 0,
      })
      .catch(() => undefined)
    if (mounted) setState("refreshing", false)
  }

  const setEnabled = async (item: DeviceSkill, enabled: boolean) => {
    const context = mutationContext()
    if (!context) return false
    const installations = item.installations ?? [{ directory: context.directories[0]!, item }]
    const pendingKey = skillPendingKey(context.scope, context.directoryKey, item.id)
    if (!begin(pendingKey)) return false
    try {
      const next = await Promise.all(
        installations.map((installation) =>
          context.api.setEnabled(installation.directory, installation.item.id, enabled),
        ),
      )
      if (context.directories.length === 1 && installations.length === 1) {
        queryClient.setQueryData(context.queryKey, next[0])
      }
      await refreshSkills(context)
      showToast({
        title: language.t(enabled ? "settings.skills.enable.success" : "settings.skills.disable.success", {
          name: item.name,
        }),
      })
      return true
    } catch (error) {
      if (installations.length > 1 || isSkillManagementNotFound(error)) {
        await refreshSkills(context).catch(() => undefined)
      }
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
      if (snapshot.directories.length === 1) queryClient.setQueryData(snapshot.queryKey, next)
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
  const confirmRemove = (item: DeviceSkill) => {
    const context = mutationContext()
    if (!item.deleteTarget || !context) return
    const directory = item.installations?.[0]?.directory ?? context.directories[0]
    if (!directory) return
    if (state.confirmation) setState("confirmation", "valid", false)
    setState("confirmation", {
      directory,
      item,
      pendingKey: skillPendingKey(context.scope, context.directoryKey, item.id),
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
    const currentDirectoryKey = directoryKey()
    const snapshot = state.confirmation
    const activeID = dialog.active?.id
    if (!snapshot) return
    if (snapshot.valid && (snapshot.scope !== sdk.scope || snapshot.directoryKey !== currentDirectoryKey)) {
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
          <div class="settings-v2-skills-heading-copy">
            <h2 class="settings-v2-tab-title">{language.t("settings.skills.title")}</h2>
            <Show when={!skills.isPending}>
              <span class="settings-v2-skills-count">
                {language.t("settings.skills.count", { count: items().length })}
              </span>
            </Show>
          </div>
          <TooltipV2 value={language.t("settings.skills.refresh")}>
            <IconButtonV2
              type="button"
              class="settings-v2-skills-refresh"
              size="small"
              variant="ghost-muted"
              disabled={directories().length === 0 || skills.isFetching}
              aria-label={language.t("settings.skills.refresh")}
              icon={<Icon name="reset" size="small" />}
              data-refreshing={state.refreshing ? "" : undefined}
              onClick={() => void refreshAll()}
            />
          </TooltipV2>
        </div>
        <div class="settings-v2-tab-search settings-v2-skills-search">
          <Show
            when={items().length > 1 || state.query.trim().length > 0}
            fallback={
              <div
                class="settings-v2-skills-search-placeholder"
                data-loading={directories().length > 0 && skills.isPending ? "" : undefined}
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
        <Show when={skills.isError && items().length > 0}>
          <div class="settings-v2-skills-refresh-error" role="alert">
            {language.t("settings.skills.refresh.failure")}
          </div>
        </Show>
        <SettingsListV2>
          <Show
            when={directories().length > 0}
            fallback={<SkillState text={language.t("settings.skills.locationRequired")} />}
          >
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
                        const installations = () => item.installations ?? []
                        const installationCount = () => installations().length
                        const source = () => language.t(sourceKey(item))
                        const sourceLabel = () =>
                          installationCount() > 1 ? `${source()} +${installationCount() - 1}` : source()
                        const sourceTitle = () =>
                          installations().length > 0
                            ? [...new Set(installations().map((installation) => installation.item.source.value))].join(
                                "\n",
                              )
                            : item.source.value
                        const scope = () => language.t(scopeKey(item))
                        const statusLabel = () => language.t(statusKey(item))
                        const blocked = () => {
                          const key = blockedKey(item)
                          return key ? language.t(key) : undefined
                        }
                        const locations = () =>
                          installations().length > 0
                            ? [
                                ...new Set(
                                  installations().map((installation) =>
                                    installation.item.source.type === "url"
                                      ? installation.item.source.value
                                      : installation.item.location,
                                  ),
                                ),
                              ]
                            : [item.source.type === "url" ? item.source.value : item.location]
                        const location = () =>
                          locations().length > 1 ? `${locations()[0]} +${locations().length - 1}` : locations()[0]!
                        const pending = () => {
                          if (directories().length === 0) return false
                          return isPending(
                            state.pendingKeys,
                            skillPendingKey(serverSDK().scope, directoryKey(), item.id),
                          )
                        }
                        return (
                          <div class="settings-v2-skills-row">
                            <div class="settings-v2-skills-copy">
                              <div class="settings-v2-skills-name">{item.name}</div>
                              <Show when={item.description}>
                                {(description) => <div class="settings-v2-skills-description">{description()}</div>}
                              </Show>
                              <div class="settings-v2-skills-meta">
                                <Tag title={sourceTitle()}>
                                  <span class="sr-only">
                                    {language.t("settings.skills.source.label", { value: sourceLabel() })}
                                  </span>
                                  <span aria-hidden="true">{sourceLabel()}</span>
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
                              <div class="settings-v2-skills-location" title={locations().join("\n")}>
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

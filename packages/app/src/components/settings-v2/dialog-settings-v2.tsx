import { type Accessor, Component, Show, createEffect, createMemo, createSignal, startTransition } from "solid-js"
import { Dialog, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneralV2 } from "./general"
import { SettingsKeybinds } from "../settings-keybinds"
import { SettingsProvidersV2 } from "./providers"
import { SettingsModelsV2 } from "./models"
import "./settings-v2.css"
import { SettingsServersV2 } from "./servers"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { tabKey, useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { SettingsSkillsV2 } from "./skills"
import { settingsDirectory, settingsModelDirectory, settingsSkillDirectory } from "@/components/settings-directory"
import { useSettings } from "@/context/settings"
import { useServer } from "@/context/server"
import { createRunLocationPresentation } from "@/product/workflow"
import { ModelsProvider } from "@/context/models"

export type SettingsTab = "general" | "shortcuts" | "models" | "providers" | "servers" | "skills"

export const DialogSettings: Component<{
  sessionID?: string
  directory?: Accessor<string | undefined>
  defaultValue?: SettingsTab
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const settings = useSettings()
  const server = useServer()
  const runLocation = createMemo(() =>
    createRunLocationPresentation({ mode: settings.general.presentationMode(), local: server.isLocal() }),
  )
  const requestedTab = props.defaultValue ?? "general"
  const [tab, setTab] = createSignal<SettingsTab>(
    requestedTab === "servers" && !runLocation().managementVisible ? "general" : requestedTab,
  )
  const directory = createMemo(
    () =>
      props.directory?.() ??
      settingsDirectory(
        layout.route(),
        tabs.store,
        (id) => serverSync().session.get(id),
        (tab) => tabs.info[tabKey(tab)],
      ),
  )
  const skillDirectory = createMemo(() =>
    settingsSkillDirectory(directory(), serverSync().data.path.config || undefined),
  )
  const modelDirectory = createMemo(() =>
    settingsModelDirectory(directory(), server.projects.last(), server.projects.list()),
  )

  createEffect(() => {
    if (runLocation().managementVisible || tab() !== "servers") return
    setTab("general")
  })

  const showProviders = () => {
    void dialog.show(() => (
      <DialogSettings sessionID={props.sessionID} directory={directory} defaultValue="providers" />
    ))
  }

  return (
    <Dialog size="x-large" variant="settings" class="settings-v2-dialog">
      <DialogTitle>
        <span class="sr-only">{language.t("sidebar.settings")}</span>
      </DialogTitle>
      <TabsV2
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value as SettingsTab))}
        class="settings-v2"
      >
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </TabsV2.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("workflow.runLocation.section")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </TabsV2.Trigger>
                    <Show when={runLocation().managementVisible}>
                      <TabsV2.Trigger value="servers">
                        <Icon name="server" />
                        {language.t("workflow.runLocation.title")}
                      </TabsV2.Trigger>
                    </Show>
                    <TabsV2.Trigger value="skills">
                      <Icon name="code" />
                      {language.t("settings.skills.title")}
                    </TabsV2.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="settings-v2-nav-footer">
              <span>{language.t("app.name.desktop")}</span>
              <span>
                v{platform.version}
                {platform.buildRevision ? ` (${platform.buildRevision.slice(0, 7)})` : ""}
              </span>
            </div>
          </div>
        </TabsV2.List>
        <TabsV2.Content value="general" class="settings-v2-panel">
          <SettingsGeneralV2 sessionID={props.sessionID} directory={directory} />
        </TabsV2.Content>
        <TabsV2.Content value="shortcuts" class="settings-v2-panel">
          <SettingsKeybinds v2 />
        </TabsV2.Content>
        <Show when={runLocation().managementVisible}>
          <TabsV2.Content value="servers" class="settings-v2-panel">
            <SettingsServersV2 />
          </TabsV2.Content>
        </Show>
        <TabsV2.Content value="providers" class="settings-v2-panel">
          <SettingsProvidersV2 directory={directory} onBack={showProviders} />
        </TabsV2.Content>
        <TabsV2.Content value="models" class="settings-v2-panel">
          <ModelsProvider directory={modelDirectory}>
            <SettingsModelsV2 onOpenProviders={() => setTab("providers")} />
          </ModelsProvider>
        </TabsV2.Content>
        <TabsV2.Content value="skills" class="settings-v2-panel">
          <SettingsSkillsV2 directory={skillDirectory()} />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}

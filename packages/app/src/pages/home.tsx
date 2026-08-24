import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show, createMemo } from "solid-js"
import { Portal } from "solid-js/web"
import { RemoteRunIndicator, StatusPopoverV2 } from "@/components/status-popover"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { createRunLocationPresentation } from "@/product/workflow"
import { ModelSetupNoticeSlot } from "@/components/workflow/model-setup-notice"
import { useModelReadiness } from "@/product/workflow/use-model-readiness"
import { createHomeController } from "./home/home-controller"
import { createHomeProjectsController } from "./home/home-projects-controller"
import { HomeUtilityNav } from "./home/home-projects-view"
import { HomeProjects } from "./home/home-projects"
import { createHomeScrollController } from "./home/home-scroll-controller"
import { createHomeSessionSearchController } from "./home/home-session-search-controller"
import { createHomeSessionsController } from "./home/home-sessions-controller"
import { HomeSessions } from "./home/home-sessions"

export function NewHome() {
  const settings = useSettings()
  const server = useServer()
  const language = useLanguage()
  const rightMount = useTitlebarRightMount()
  const runLocation = createMemo(() =>
    createRunLocationPresentation({ mode: settings.general.presentationMode(), local: server.isLocal() }),
  )
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  const modelReadiness = useModelReadiness({ directory: () => home.project.newSession()?.worktree })
  return (
    <>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Show when={runLocation().remoteIndicatorVisible}>
              <RemoteRunIndicator />
            </Show>
            <Show when={settings.visibility.status() && runLocation().statusVisible}>
              <TooltipV2 placement="bottom" value={language.t("workflow.runLocation.status.title")}>
                <StatusPopoverV2 scope="server" />
              </TooltipV2>
            </Show>
          </Portal>
        )}
      </Show>
      <div
        class={`
          m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px]
          bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
        `}
      >
        <h1 class="sr-only">{sessions.copy.language.t("home.title")}</h1>
        <ScrollView
          aria-label={sessions.copy.language.t("home.title")}
          class="h-full [container-type:size]"
          thumbContainer={scroll.viewport.thumbTrack}
          thumbHoverTarget={scroll.viewport.hoverTarget}
          viewportRef={scroll.viewport.setViewport}
          onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
          onWheel={scroll.viewport.containOuterWheel}
        >
          <div
            class={`
              mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3
              lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
            `}
          >
            <HomeProjects projects={projects} scroll={scroll} />
            <div class="flex min-h-0 min-w-0 flex-col">
              <ModelSetupNoticeSlot readiness={modelReadiness.readiness} class="mt-6 lg:mt-12" />
              <HomeSessions sessions={sessions} search={search} scroll={scroll} />
            </div>
            <HomeUtilityNav
              class="flex lg:hidden"
              onOpenSettings={projects.utility.settings}
              onOpenHelp={projects.utility.help}
              language={projects.copy.language}
            />
          </div>
        </ScrollView>
      </div>
    </>
  )
}

import type { ProjectMeta } from "./global-sync/types"

export type ProjectMetadata = {
  id?: string
  worktree: string
  name?: string
  icon?: {
    url?: string
    override?: string
    color?: string
  }
  commands?: {
    start?: string
  }
}

export type MergedProjectMetadata<T extends Omit<ProjectMetadata, "worktree">> = Omit<
  T,
  "name" | "icon" | "commands"
> & {
  name?: string
  icon?: ProjectMetadata["icon"]
  commands?: ProjectMetadata["commands"]
}

export function mergeProjectMetadata<T extends Omit<ProjectMetadata, "worktree">>(
  server: T,
  local?: ProjectMeta,
): MergedProjectMetadata<T> {
  if (!local) return server

  const icon = local.icon
    ? {
        ...server.icon,
        ...(local.icon.override === undefined ? {} : { override: local.icon.override }),
        ...(local.icon.color === undefined ? {} : { color: local.icon.color }),
      }
    : server.icon
  const commands = local.commands
    ? {
        ...server.commands,
        ...(local.commands.start === undefined ? {} : { start: local.commands.start }),
      }
    : server.commands

  return {
    ...server,
    ...(local.name === undefined ? {} : { name: local.name }),
    ...(icon === undefined ? {} : { icon }),
    ...(commands === undefined ? {} : { commands }),
  }
}

export async function persistProjectMetadata<T extends ProjectMetadata>(input: {
  protocol: "v1" | "v2"
  project: T
  patch: ProjectMeta
  updateServer: (input: { projectID: string; directory: string; patch: ProjectMeta }) => Promise<T | undefined>
  writeLocal: (patch: ProjectMeta) => void | Promise<void>
  updateProjection: (project: MergedProjectMetadata<T>) => void | Promise<void>
}) {
  const serverBacked = input.protocol === "v1" && !!input.project.id && input.project.id !== "global"
  const source = serverBacked
    ? await input.updateServer({
        projectID: input.project.id!,
        directory: input.project.worktree,
        patch: input.patch,
      })
    : input.project

  if (!source) throw new Error("The server did not confirm the project update.")

  const project = mergeProjectMetadata(source, input.patch)
  await input.writeLocal(input.patch)
  await input.updateProjection(project)
  return project
}

export function projectMetadataErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: unknown } }).data
    if (typeof data?.message === "string" && data.message) return data.message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function needsAutomaticProjectColor(project: Pick<ProjectMetadata, "icon">) {
  return project.icon?.color === undefined && !project.icon?.override && !project.icon?.url
}

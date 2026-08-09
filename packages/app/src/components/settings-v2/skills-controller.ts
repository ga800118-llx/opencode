import { Skill } from "@opencode-ai/schema/skill"

export type SkillStatusFilter = "all" | Skill.ManagementInfo["status"]

export async function loadSkillManagement(
  list: () => Promise<Skill.ManagementInfo[]>,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
) {
  const delays = [100, 200] as const
  const load = async (attempt: number): Promise<Skill.ManagementInfo[]> => {
    const result = await list()
    if (result.length > 0 || attempt === delays.length) return result
    await wait(delays[attempt]!)
    return load(attempt + 1)
  }
  return load(0)
}

export function filterSkills(
  items: readonly Skill.ManagementInfo[],
  input: { query: string; status: SkillStatusFilter },
) {
  const query = input.query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (input.status !== "all" && item.status !== input.status) return false
    if (!query) return true
    return [item.name, item.description, item.location, item.source.value]
      .filter((value): value is string => value !== undefined)
      .some((value) => value.toLocaleLowerCase().includes(query))
  })
}

export function sourceKey(item: Skill.ManagementInfo) {
  if (item.source.type === "builtin") return "settings.skills.source.builtin" as const
  if (item.source.type === "url") return "settings.skills.source.remote" as const
  if (item.source.type === "plugin") return "settings.skills.source.plugin" as const
  if (item.source.type === "external") return "settings.skills.source.external" as const
  return item.source.scope === "global"
    ? ("settings.skills.source.global" as const)
    : ("settings.skills.source.project" as const)
}

export function statusKey(item: Skill.ManagementInfo) {
  if (item.status === "active") return "settings.skills.status.active" as const
  if (item.status === "disabled") return "settings.skills.status.disabled" as const
  return "settings.skills.status.shadowed" as const
}

export function scopeKey(item: Skill.ManagementInfo) {
  return item.source.scope === "global"
    ? ("settings.skills.scope.global" as const)
    : ("settings.skills.scope.project" as const)
}

export function blockedKey(item: Skill.ManagementInfo) {
  if (item.deleteBlocked === "builtin") return "settings.skills.deleteBlocked.builtin" as const
  if (item.deleteBlocked === "remote") return "settings.skills.deleteBlocked.remote" as const
  if (item.deleteBlocked === "plugin") return "settings.skills.deleteBlocked.plugin" as const
  if (item.deleteBlocked === "shared") return "settings.skills.deleteBlocked.shared" as const
  if (item.deleteBlocked === "unsafe") return "settings.skills.deleteBlocked.unsafe" as const
  return undefined
}

export function skillPendingKey(scope: string, directory: string, id: Skill.ManagementID) {
  return JSON.stringify([scope, directory, id])
}

export function isPending(pendingKeys: ReadonlySet<string>, key: string) {
  return pendingKeys.has(key)
}

export function createSkillRefreshQueue<Key>(refresh: (key: Key) => Promise<void>) {
  let queue = Promise.resolve()
  return (key: Key) => {
    const current = queue.then(() => refresh(key))
    queue = current.catch(() => undefined)
    return current
  }
}

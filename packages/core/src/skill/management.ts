import { Skill } from "@opencode-ai/schema/skill"
import { Hash } from "../util/hash"

export type Installed = {
  source: Skill.Source
  info: Skill.Info
}

export function id(entry: Installed) {
  return Skill.ManagementID.make(
    Hash.sha256([Skill.Source.key(entry.source), entry.info.name, entry.info.location].join("\0")),
  )
}

export function project(entries: readonly Installed[], disabled: ReadonlySet<Skill.ManagementID>) {
  const enabled = entries.filter((entry) => !disabled.has(id(entry)))
  const active = new Map(enabled.map((entry) => [entry.info.name, id(entry)]))
  return entries.map((entry) => {
    const installationID = id(entry)
    const isEnabled = !disabled.has(installationID)
    return toInfo(
      entry,
      installationID,
      isEnabled ? (active.get(entry.info.name) === installationID ? "active" : "shadowed") : "disabled",
    )
  })
}

export function effective(entries: readonly Installed[], disabled: ReadonlySet<Skill.ManagementID>) {
  const skills = new Map<string, Skill.Info>()
  entries.filter((entry) => !disabled.has(id(entry))).forEach((entry) => skills.set(entry.info.name, entry.info))
  return Array.from(skills.values())
}

function toInfo(
  entry: Installed,
  installationID: Skill.ManagementID,
  status: typeof Skill.ManagementStatus.Type,
): Skill.ManagementInfo {
  const sourceInfo = source(entry.source)
  return {
    id: installationID,
    name: entry.info.name,
    description: entry.info.description,
    location: entry.info.location,
    source: sourceInfo,
    status,
    enabled: status !== "disabled",
    deletable: false,
    deleteBlocked:
      sourceInfo.type === "builtin"
        ? "builtin"
        : sourceInfo.type === "url"
          ? "remote"
          : sourceInfo.type === "plugin"
            ? "plugin"
            : "unsafe",
  }
}

function source(input: Skill.Source): typeof Skill.ManagementSource.Type {
  if (!input.origin) {
    return {
      type: "plugin",
      scope: "project",
      value: input.type === "directory" ? input.path : input.type === "url" ? input.url : input.skill.name,
    }
  }
  if (input.origin.type === "builtin") {
    return {
      type: "builtin",
      scope: input.origin.scope,
      value: input.origin.value ?? (input.type === "embedded" ? input.skill.name : Skill.Source.key(input)),
    }
  }
  if (input.type === "directory") return { type: "directory", scope: input.origin.scope, value: input.path }
  if (input.type === "url") return { type: "url", scope: input.origin.scope, value: input.url }
  return { type: "plugin", scope: input.origin.scope, value: input.origin.value ?? input.skill.name }
}

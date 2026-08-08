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
  const identified = entries.map((entry) => ({ entry, id: id(entry) }))
  const active = new Map(
    identified
      .filter((item) => !disabled.has(item.id))
      .map((item) => [item.entry.info.name, item.id]),
  )
  return identified.map((item) => {
    const isEnabled = !disabled.has(item.id)
    return toInfo(
      item.entry,
      item.id,
      isEnabled ? (active.get(item.entry.info.name) === item.id ? "active" : "shadowed") : "disabled",
    )
  })
}

export function effective(entries: readonly Installed[], disabled: ReadonlySet<Skill.ManagementID>) {
  const skills = new Map<string, Skill.Info>()
  entries
    .map((entry) => ({ entry, id: id(entry) }))
    .filter((item) => !disabled.has(item.id))
    .forEach((item) => skills.set(item.entry.info.name, item.entry.info))
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
  if (input.origin.type === "plugin") {
    return {
      type: "plugin",
      scope: input.origin.scope,
      value:
        input.origin.value ?? (input.type === "directory" ? input.path : input.type === "url" ? input.url : input.skill.name),
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

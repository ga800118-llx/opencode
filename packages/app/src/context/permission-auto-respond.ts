import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Permission } from "@opencode-ai/schema/permission"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  return autoAccept[key] ?? autoAccept[sessionID]
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function modeAutoRespondsPermission(
  taskMode: Record<string, Permission.Mode>,
  session: { id: string; parentID?: string; permissionMode?: Permission.Mode }[],
  permission: { sessionID: string },
) {
  return lineagePermissionMode(taskMode, session, permission) === "auto"
}

export function lineagePermissionMode(
  taskMode: Record<string, Permission.Mode>,
  session: { id: string; parentID?: string; permissionMode?: Permission.Mode }[],
  permission: { sessionID: string },
) {
  const byID = new Map(session.map((item) => [item.id, item]))
  return sessionLineage(session, permission.sessionID)
    .map((id) => taskMode[id] ?? byID.get(id)?.permissionMode)
    .find((item): item is Permission.Mode => item !== undefined)
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionAutoAccept(autoAccept, session, permission, directory)
  if (value !== undefined) return value
  return directory ? isDirectoryAutoAccepting(autoAccept, directory) : false
}

export function sessionAutoAccept(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
}

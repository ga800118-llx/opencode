import type { SessionApi, SessionInfo, SessionListInput } from "@opencode-ai/client/promise"
import type { Permission } from "@opencode-ai/schema/permission"
import type { Session } from "@opencode-ai/sdk/v2/client"

type CurrentSessionInfo = SessionInfo & { readonly permissionMode?: Permission.Mode }
type NormalizedSession = Session & { readonly permissionMode?: Permission.Mode }

export function normalizeSessionInfo(input: CurrentSessionInfo | Session): NormalizedSession {
  if (!("location" in input)) return input
  return {
    id: input.id,
    slug: input.id,
    projectID: input.projectID,
    workspaceID: input.location.workspaceID,
    directory: input.location.directory,
    path: input.subpath,
    parentID: input.parentID,
    cost: input.cost,
    tokens: input.tokens,
    title: input.title,
    agent: input.agent,
    model: input.model,
    permissionMode: input.permissionMode,
    version: "",
    time: input.time,
    revert: input.revert && {
      messageID: input.revert.messageID,
      partID: input.revert.partID,
      snapshot: input.revert.snapshot,
    },
  }
}

export async function listAllSessions(api: Pick<SessionApi, "list">, input: Omit<SessionListInput, "cursor">) {
  const load = async (cursor?: string): Promise<Session[]> => {
    const result = await api.list({ ...input, limit: input.limit ?? 100, cursor })
    const sessions = result.data.map(normalizeSessionInfo)
    if (result.data.length === 0 || !result.cursor.next) return sessions
    return [...sessions, ...(await load(result.cursor.next))]
  }
  return load()
}

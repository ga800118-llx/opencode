import { ServerConnection, serverName } from "@/context/server"

export function runLocationName(connection: ServerConnection.Any, localName: string, ignoreDisplayName = false) {
  if (ServerConnection.builtin(connection)) return localName
  return serverName(connection, ignoreDisplayName)
}

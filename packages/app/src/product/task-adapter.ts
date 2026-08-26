import type { SessionInfo } from "@opencode-ai/client/promise"
import type { Permission } from "@opencode-ai/schema/permission"
import type { AgentPartInput, FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { Event } from "@opencode-ai/schema/event"
import { Identifier } from "@/utils/id"
import type { CompatibleApi } from "@/utils/server-compat"
import {
  productPersonalizationMetadataKey,
  type ProductFilePart,
  type ProductPromptPart,
  type ProductTaskAdapter,
  type ProductTextPart,
} from "./contracts"
import { normalizeProductError } from "./errors"

export type ProductTaskAdapterIDs = {
  readonly messageID?: () => string
  readonly operationID?: () => string
}

type LegacyPart = (TextPartInput | FilePartInput | AgentPartInput) & { readonly id: string }
type PermissionModeSessionApi = Omit<CompatibleApi["session"], "create"> & {
  readonly create: (
    input: NonNullable<Parameters<CompatibleApi["session"]["create"]>[0]> & {
      readonly permissionMode?: Permission.Mode
    },
  ) => ReturnType<CompatibleApi["session"]["create"]>
}

export function createProductTaskAdapter(
  api: CompatibleApi,
  ids: ProductTaskAdapterIDs = {},
): ProductTaskAdapter<SessionInfo> {
  const messageID = ids.messageID ?? (() => Identifier.ascending("message"))
  const operationID = ids.operationID ?? (() => Event.ID.create())

  return {
    async create(input) {
      const record = await normalizeCall(() =>
        (api.session as PermissionModeSessionApi).create({
          agent: input.agent,
          model: {
            id: input.model.modelID,
            providerID: input.model.providerID,
            variant: input.model.variant,
          },
          ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
          location: { directory: input.directory },
        }),
      )
      return {
        task: { id: record.id, directory: record.location.directory, title: record.title },
        record,
      }
    },
    async prompt(input) {
      const id = input.messageID ?? messageID()
      await normalizeCall(() =>
        api.session.prompt({
          sessionID: input.taskID,
          id,
          system: input.system,
          metadata: input.system ? { [productPersonalizationMetadataKey]: input.system } : undefined,
          agent: input.agent,
          model: { providerID: input.model.providerID, modelID: input.model.modelID },
          variant: input.model.variant,
          location: { directory: input.directory },
          legacyParts: input.parts.map(toLegacyPart),
          text: input.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
          files: input.parts.flatMap((part) => {
            if (part.type !== "file") return []
            return [
              {
                uri: part.uri,
                name: part.name,
                mention: part.source?.text
                  ? { text: part.source.text.value, start: part.source.text.start, end: part.source.text.end }
                  : undefined,
              },
            ]
          }),
          agents: input.parts.flatMap((part) =>
            part.type === "agent" ? [{ name: part.name, mention: part.mention }] : [],
          ),
        }),
      )
      return { taskID: input.taskID, operationID: id }
    },
    async command(input) {
      const id = input.messageID ?? messageID()
      await normalizeCall(() =>
        api.session.command({
          sessionID: input.taskID,
          id,
          command: input.command,
          arguments: input.arguments,
          agent: input.agent,
          model: {
            id: input.model.modelID,
            providerID: input.model.providerID,
            variant: input.model.variant,
          },
          files: input.files?.map(toModernFile),
          location: { directory: input.directory },
        }),
      )
      return { taskID: input.taskID, operationID: id }
    },
    async shell(input) {
      const id = input.operationID ?? operationID()
      await normalizeCall(() =>
        api.session.shell({
          sessionID: input.taskID,
          id,
          command: input.command,
          agent: input.agent,
          model: { providerID: input.model.providerID, modelID: input.model.modelID },
          location: { directory: input.directory },
        }),
      )
      return { taskID: input.taskID, operationID: id }
    },
    async interrupt(input) {
      await normalizeCall(() =>
        api.session.interrupt({ sessionID: input.taskID, location: { directory: input.directory } }),
      )
    },
  }
}

function toLegacyPart(part: ProductPromptPart): LegacyPart {
  if (part.type === "text") return toLegacyText(part)
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      url: part.uri,
      filename: part.name,
      mime: part.mime,
      source: part.source,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.mention && { value: part.mention.text, start: part.mention.start, end: part.mention.end },
  }
}

function toLegacyText(part: ProductTextPart): LegacyPart {
  return {
    id: part.id,
    type: "text",
    text: part.text,
    ...(part.synthetic === undefined ? {} : { synthetic: part.synthetic }),
    ...(part.ignored === undefined ? {} : { ignored: part.ignored }),
    ...(part.time === undefined ? {} : { time: part.time }),
    ...(part.metadata?.comment ? { metadata: { opencodeComment: part.metadata.comment } } : {}),
  }
}

function toModernFile(part: ProductFilePart) {
  return {
    uri: part.uri,
    name: part.name,
    mention: part.source?.text
      ? { text: part.source.text.value, start: part.source.text.start, end: part.source.text.end }
      : undefined,
  }
}

function normalizeCall<T>(operation: () => Promise<T>) {
  return Promise.resolve()
    .then(operation)
    .catch((error) => {
      throw normalizeProductError(error)
    })
}

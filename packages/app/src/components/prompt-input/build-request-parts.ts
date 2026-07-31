import { getFilename } from "@opencode-ai/core/util/path"
import type { Part } from "@opencode-ai/sdk/v2/client"
import type { FileSelection } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import type { ProductPromptPart } from "@/product/contracts"
import { Identifier } from "@/utils/id"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"

type ContextFile = {
  key: string
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

type BuildRequestPartsInput = {
  prompt: Prompt
  context: ContextFile[]
  images: ImageAttachmentPart[]
  text: string
  messageID: string
  sessionID: string
  sessionDirectory: string
}

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"

const toOptimisticPart = (part: ProductPromptPart, sessionID: string, messageID: string): Part => {
  if (part.type === "text") {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      synthetic: part.synthetic,
      ignored: part.ignored,
      time: part.time,
      metadata: part.metadata?.comment ? createCommentMetadata(part.metadata.comment) : undefined,
      sessionID,
      messageID,
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      mime: part.mime,
      filename: part.name,
      url: part.uri,
      source: part.source,
      sessionID,
      messageID,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.mention && { value: part.mention.text, start: part.mention.start, end: part.mention.end },
    sessionID,
    messageID,
  }
}

export function buildRequestParts(input: BuildRequestPartsInput) {
  const requestParts: ProductPromptPart[] = input.text.trim()
    ? [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: input.text,
        },
      ]
    : []

  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    const source = attachment.source
      ? {
          ...attachment.source,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
        }
      : {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path,
        }
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime ?? "text/plain",
      uri: attachment.url ?? `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      name: attachment.filename ?? getFilename(attachment.path),
      source,
    } satisfies ProductPromptPart
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "agent",
      name: attachment.name,
      mention: {
        text: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    } satisfies ProductPromptPart
  })

  const used = new Set(files.map((part) => part.uri))
  const context = input.context.flatMap((item) => {
    const path = absolute(input.sessionDirectory, item.path)
    const url = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    if (!comment && used.has(url)) return []
    used.add(url)

    const filePart = {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      uri: url,
      name: getFilename(item.path),
    } satisfies ProductPromptPart

    if (!comment) return [filePart]

    const mentions = parseCommentMentions(comment).flatMap((path) => {
      const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
      if (used.has(url)) return []
      used.add(url)
      return [
        {
          id: Identifier.ascending("part"),
          type: "file",
          mime: "text/plain",
          uri: url,
          name: getFilename(path),
        } satisfies ProductPromptPart,
      ]
    })

    return [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text: formatCommentNote({ path: item.path, selection: item.selection, comment }),
        synthetic: true,
        metadata: {
          comment: {
            path: item.path,
            selection: item.selection,
            comment,
            preview: item.preview,
            origin: item.commentOrigin,
          },
        },
      } satisfies ProductPromptPart,
      filePart,
      ...mentions,
    ]
  })

  const images = input.images.map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime,
      uri: attachment.dataUrl,
      name: attachment.sourcePath ?? attachment.filename,
    } satisfies ProductPromptPart
  })

  requestParts.push(...files, ...context, ...agents, ...images)

  return {
    requestParts,
    optimisticParts: requestParts.map((part) => toOptimisticPart(part, input.sessionID, input.messageID)),
  }
}

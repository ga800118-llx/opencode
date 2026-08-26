import type { Permission } from "@opencode-ai/schema/permission"

export type ProductTaskID = string
export type ProductMessageID = string
export type ProductOperationID = string
export type ProductPartID = string
export type ProductDirectory = string

export type ProductModelSelection = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export type ProductModelReference = Pick<ProductModelSelection, "providerID" | "modelID">

export type ProductMention = {
  readonly text: string
  readonly start: number
  readonly end: number
}

export type ProductPartTime = {
  readonly start: number
  readonly end?: number
}

export type ProductFileSelection = {
  readonly startLine: number
  readonly startChar: number
  readonly endLine: number
  readonly endChar: number
}

export type ProductCommentMetadata = {
  readonly path: string
  readonly selection?: ProductFileSelection
  readonly comment: string
  readonly preview?: string
  readonly origin?: "review" | "file"
}

export type ProductTextPart = {
  readonly id: ProductPartID
  readonly type: "text"
  readonly text: string
  readonly synthetic?: boolean
  readonly ignored?: boolean
  readonly time?: ProductPartTime
  readonly metadata?: {
    readonly comment?: ProductCommentMetadata
  }
}

export type ProductSourcePosition = {
  readonly line: number
  readonly character: number
}

export type ProductSourceRange = {
  readonly start: ProductSourcePosition
  readonly end: ProductSourcePosition
}

export type ProductSourceText = {
  readonly value: string
  readonly start: number
  readonly end: number
}

export type ProductPathSource = {
  readonly type: "file"
  readonly path: string
  readonly text: ProductSourceText
}

export type ProductSymbolSource = {
  readonly type: "symbol"
  readonly path: string
  readonly range: ProductSourceRange
  readonly name: string
  readonly kind: number
  readonly text: ProductSourceText
}

export type ProductResourceSource = {
  readonly type: "resource"
  readonly clientName: string
  readonly uri: string
  readonly text: ProductSourceText
}

export type ProductFileSource = ProductPathSource | ProductSymbolSource | ProductResourceSource

export type ProductFilePart = {
  readonly id: ProductPartID
  readonly type: "file"
  readonly uri: string
  readonly name?: string
  readonly mime: string
  readonly source?: ProductFileSource
}

export type ProductAgentPart = {
  readonly id: ProductPartID
  readonly type: "agent"
  readonly name: string
  readonly mention?: ProductMention
}

export type ProductPromptPart = ProductTextPart | ProductFilePart | ProductAgentPart

export type ProductTask = {
  readonly id: ProductTaskID
  readonly directory: ProductDirectory
  readonly title?: string
}

export type ProductCreateTaskInput = {
  readonly directory: ProductDirectory
  readonly agent: string
  readonly model: ProductModelSelection
  readonly permissionMode?: Permission.Mode
}

export type ProductCreateTaskOutput<SessionRecord = unknown> = {
  readonly task: ProductTask
  readonly record: Readonly<SessionRecord>
}

export const productPersonalizationMetadataKey = "guai.personalization"

export type ProductPromptInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly messageID?: ProductMessageID
  readonly system?: string
  readonly parts: readonly ProductPromptPart[]
  readonly agent: string
  readonly model: ProductModelSelection
}

export type ProductCommandInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly messageID?: ProductMessageID
  readonly command: string
  readonly arguments: string
  readonly files?: readonly ProductFilePart[]
  readonly agent: string
  readonly model: ProductModelSelection
}

export type ProductShellInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly operationID?: ProductOperationID
  readonly command: string
  readonly agent: string
  readonly model: ProductModelReference
}

export type ProductOperationOutput = {
  readonly taskID: ProductTaskID
  readonly operationID?: ProductOperationID
}

export type ProductInterruptInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
}

export type ProductTaskAdapter<SessionRecord = unknown> = {
  readonly create: (input: ProductCreateTaskInput) => Promise<ProductCreateTaskOutput<SessionRecord>>
  readonly prompt: (input: ProductPromptInput) => Promise<ProductOperationOutput>
  readonly command: (input: ProductCommandInput) => Promise<ProductOperationOutput>
  readonly shell: (input: ProductShellInput) => Promise<ProductOperationOutput>
  readonly interrupt: (input: ProductInterruptInput) => Promise<ProductOperationOutput | void>
}

export type ProductEventEnvelope<Type extends string = string, Data = unknown> = {
  readonly id?: string
  readonly type: Type
  readonly directory?: ProductDirectory
  readonly time?: number
  readonly data: Data
}

export type ProductTaskEvent<Type extends string = string, Data = unknown> = ProductEventEnvelope<Type, Data> & {
  readonly taskID: ProductTaskID
}

export type ProductOptionalTaskEvent<Type extends string = string, Data = unknown> = ProductEventEnvelope<
  Type,
  Data
> & {
  readonly taskID?: ProductTaskID
}

export type ProductErrorKind =
  | "unreachable-endpoint"
  | "authentication"
  | "incompatible-api"
  | "missing-model"
  | "streaming"
  | "tool-calling"
  | "timeout"
  | "tls"
  | "server-crash"
  | "model-runtime-unreconciled"
  | "aborted"
  | "unknown"

export type ProductErrorDiagnostic = {
  readonly name?: string
  readonly code?: string
  readonly status?: number
  readonly requestID?: string
}

export type ProductError = {
  readonly kind: ProductErrorKind
  readonly message: string
  readonly action: string
  readonly retryable: boolean
  readonly diagnostic?: ProductErrorDiagnostic
}

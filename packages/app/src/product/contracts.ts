export type ProductTaskID = string
export type ProductMessageID = string
export type ProductDirectory = string

export type ProductModelSelection = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export type ProductMention = {
  readonly text: string
  readonly start: number
  readonly end: number
}

export type ProductFileInput = {
  readonly uri: string
  readonly name?: string
  readonly mime?: string
  readonly mention?: ProductMention
}

export type ProductAgentInput = {
  readonly name: string
  readonly mention?: ProductMention
}

export type ProductTask = {
  readonly id: ProductTaskID
  readonly directory: ProductDirectory
  readonly title?: string
}

export type ProductCreateTaskInput = {
  readonly directory: ProductDirectory
  readonly title?: string
  readonly agent: string
  readonly model: ProductModelSelection
}

export type ProductCreateTaskOutput = {
  readonly task: ProductTask
}

export type ProductPromptInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly messageID?: ProductMessageID
  readonly text: string
  readonly files?: readonly ProductFileInput[]
  readonly agents?: readonly ProductAgentInput[]
  readonly agent: string
  readonly model: ProductModelSelection
}

export type ProductCommandInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly messageID?: ProductMessageID
  readonly command: string
  readonly arguments: string
  readonly files?: readonly ProductFileInput[]
  readonly agent: string
  readonly model: ProductModelSelection
}

export type ProductShellInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly messageID?: ProductMessageID
  readonly command: string
  readonly agent: string
  readonly model: ProductModelSelection
}

export type ProductMessageOutput = {
  readonly taskID: ProductTaskID
  readonly messageID: ProductMessageID
}

export type ProductInterruptInput = {
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
}

export type ProductInterruptOutput = {
  readonly taskID: ProductTaskID
  readonly interrupted: boolean
}

export type ProductTaskAdapter = {
  readonly create: (input: ProductCreateTaskInput) => Promise<ProductCreateTaskOutput>
  readonly prompt: (input: ProductPromptInput) => Promise<ProductMessageOutput>
  readonly command: (input: ProductCommandInput) => Promise<ProductMessageOutput>
  readonly shell: (input: ProductShellInput) => Promise<ProductMessageOutput>
  readonly interrupt: (input: ProductInterruptInput) => Promise<ProductInterruptOutput>
}

export type ProductTaskEvent<Type extends string = string, Data = unknown> = {
  readonly type: Type
  readonly taskID: ProductTaskID
  readonly directory: ProductDirectory
  readonly time: number
  readonly data: Data
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

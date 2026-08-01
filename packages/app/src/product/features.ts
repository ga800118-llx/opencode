export type ProductFeatureFlags = {
  readonly cloudProviders: boolean
  readonly customProviders: boolean
  readonly localModels: boolean
  readonly modelSelection: boolean
  readonly modelVariants: boolean
  readonly taskHistory: boolean
  readonly streaming: boolean
  readonly toolCalling: boolean
  readonly permissions: boolean
  readonly fileBrowser: boolean
  readonly diffReview: boolean
  readonly terminal: boolean
  readonly worktrees: boolean
  readonly agentShell: boolean
  readonly separateTerminalAndAgentShell: boolean
  readonly agents: boolean
  readonly mcp: boolean
  readonly skills: boolean
  readonly commands: boolean
  readonly attachments: boolean
  readonly multipleTasks: boolean
  readonly localization: boolean
  readonly diagnostics: boolean
  readonly revertRestore: boolean
  readonly multipleServers: boolean
  readonly visualProviderProfiles: boolean
  readonly keychainCredentials: boolean
  readonly automaticLocalModelDiscovery: boolean
  readonly taskCrashRecovery: boolean
}

export const PRODUCT_FEATURES = Object.freeze({
  cloudProviders: true,
  customProviders: true,
  localModels: true,
  modelSelection: true,
  modelVariants: true,
  taskHistory: true,
  streaming: true,
  toolCalling: true,
  permissions: true,
  fileBrowser: true,
  diffReview: true,
  terminal: true,
  worktrees: true,
  agentShell: true,
  separateTerminalAndAgentShell: true,
  agents: true,
  mcp: true,
  skills: true,
  commands: true,
  attachments: true,
  multipleTasks: true,
  localization: true,
  diagnostics: true,
  revertRestore: true,
  multipleServers: true,
  visualProviderProfiles: true,
  keychainCredentials: true,
  automaticLocalModelDiscovery: true,
  taskCrashRecovery: false,
}) satisfies ProductFeatureFlags

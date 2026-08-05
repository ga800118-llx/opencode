import type { ProductPresentationMode } from "@/product/workflow/presentation"

export type TaskPresentationVisibility = Readonly<{
  review: boolean
  files: boolean
  terminal: boolean
  agents: boolean
  status: boolean
}>

export type TaskToolDetails = Readonly<{
  shell: boolean
  edit: boolean
}>

export type TaskPresentation = Readonly<{
  mode: ProductPresentationMode
  toolDetails: TaskToolDetails
  contextActionDensity: "compact" | "full"
  visibility: TaskPresentationVisibility
  capabilities: Readonly<{
    review: true
    terminal: true
    files: true
    permissions: true
    questions: true
    attachments: true
    childSessions: true
    commands: true
    model: true
  }>
}>

const capabilities = Object.freeze({
  review: true,
  terminal: true,
  files: true,
  permissions: true,
  questions: true,
  attachments: true,
  childSessions: true,
  commands: true,
  model: true,
}) satisfies TaskPresentation["capabilities"]

export function createTaskPresentation(input: {
  mode: ProductPresentationMode
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  visibility: TaskPresentationVisibility
}): TaskPresentation {
  const advanced = input.mode === "advanced"
  return Object.freeze({
    mode: input.mode,
    toolDetails: createTaskToolDetails(input),
    contextActionDensity: advanced ? "full" : "compact",
    visibility: Object.freeze({ ...input.visibility }),
    capabilities,
  })
}

export function createTaskToolDetails(input: {
  mode: ProductPresentationMode
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
}): TaskToolDetails {
  const advanced = input.mode === "advanced"
  return Object.freeze({
    shell: advanced && input.shellToolPartsExpanded,
    edit: advanced && input.editToolPartsExpanded,
  })
}

export function sameTaskToolDetails(previous: TaskToolDetails, next: TaskToolDetails) {
  return previous.shell === next.shell && previous.edit === next.edit
}

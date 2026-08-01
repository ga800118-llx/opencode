import type { ProductPresentationMode } from "@/product/workflow/presentation"

export type NewSessionControlPriority = "primary" | "secondary"
export type NewSessionControl =
  | "composer"
  | "project"
  | "worktree"
  | "git"
  | "agent"
  | "model"
  | "commands"
  | "attachments"
  | "options"
  | "submit"
  | "modelReadiness"
  | "providerPromotion"

export type NewSessionControlPresentation = Readonly<{
  visible: true
  priority: NewSessionControlPriority
}>

export type NewSessionPresentation = Readonly<{
  mode: ProductPresentationMode
  controls: Readonly<Record<NewSessionControl, NewSessionControlPresentation>>
}>

const primary = Object.freeze({ visible: true, priority: "primary" }) satisfies NewSessionControlPresentation
const secondary = Object.freeze({ visible: true, priority: "secondary" }) satisfies NewSessionControlPresentation

const presentations = Object.freeze({
  simple: Object.freeze({
    mode: "simple",
    controls: Object.freeze({
      composer: primary,
      project: primary,
      worktree: secondary,
      git: secondary,
      agent: primary,
      model: primary,
      commands: primary,
      attachments: primary,
      options: primary,
      submit: primary,
      modelReadiness: primary,
      providerPromotion: secondary,
    }),
  }),
  advanced: Object.freeze({
    mode: "advanced",
    controls: Object.freeze({
      composer: primary,
      project: primary,
      worktree: primary,
      git: primary,
      agent: primary,
      model: primary,
      commands: primary,
      attachments: primary,
      options: primary,
      submit: primary,
      modelReadiness: primary,
      providerPromotion: primary,
    }),
  }),
}) satisfies Readonly<Record<ProductPresentationMode, NewSessionPresentation>>

export function createNewSessionPresentation(mode: ProductPresentationMode) {
  return presentations[mode]
}

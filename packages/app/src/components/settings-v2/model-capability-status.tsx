import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import type { ProductModelClassification } from "@/product/model-center"

const LABELS = {
  "agent-capable": "settings.modelCenter.status.agentCapable",
  "partially-compatible": "settings.modelCenter.status.partial",
  "chat-only": "settings.modelCenter.status.chatOnly",
  incompatible: "settings.modelCenter.status.incompatible",
} as const

export const ModelCapabilityStatus: Component<{ classification?: ProductModelClassification }> = (props) => {
  const language = useLanguage()
  const classification = () => props.classification ?? "untested"

  return (
    <Tag class={`model-center-capability model-center-capability--${classification()}`}>
      {props.classification
        ? language.t(LABELS[props.classification])
        : language.t("settings.modelCenter.status.untested")}
    </Tag>
  )
}

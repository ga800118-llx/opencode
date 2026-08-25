import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import * as OpenAIChat from "./openai-chat"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = RouteRoutedModelInput

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses OpenAI Chat request lowering and stream
 * parsing while accepting compatible-provider metadata, usage, and error
 * events. Provider helpers configure the route endpoint before model selection.
 */
export const route = Route.make({
  id: ADAPTER,
  protocol: OpenAIChat.compatibleProtocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"

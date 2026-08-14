export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { optional } from "./schema"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

export interface PromptEntry extends Schema.Schema.Type<typeof PromptEntry> {}
export const PromptEntry = Schema.Struct({
  type: Schema.Literal("prompt"),
  ...Admitted.fields,
}).annotate({ identifier: "SessionInput.PromptEntry" })

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({
  type: Schema.Literal("compaction"),
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  timeCreated: DateTimeUtcFromMillis,
}).annotate({ identifier: "SessionInput.Compaction" })

export interface CompactionEntry extends Schema.Schema.Type<typeof CompactionEntry> {}
export const CompactionEntry = Schema.Struct({
  ...Compaction.fields,
  handledSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.CompactionEntry" })

export const Entry = Schema.Union([PromptEntry, CompactionEntry]).pipe(Schema.toTaggedUnion("type"))
export type Entry = typeof Entry.Type

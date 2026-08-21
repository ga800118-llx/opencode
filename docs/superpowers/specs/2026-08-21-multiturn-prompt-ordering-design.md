# Multiturn Prompt Ordering Design

## Problem

In the second and later turns of a task, a streamed assistant response can temporarily render above the newly submitted user message. Once the durable message page reloads, the response moves below the correct user message.

A separate observed second turn produced no assistant response. Durable events show that the prompt was admitted and promoted, then execution was interrupted 148 milliseconds after it started. The current submit handler interprets any empty submission while a task is working as a stop request. A duplicate submit produced by Enter, form handling, or an input method can therefore cancel a request immediately after the editor is cleared.

## Design

### Optimistic Timeline Projection

When an optimistic user message is added, project the corresponding user entry into both message representations:

- the normalized message and part caches used by the existing prompt UI;
- the V2 `session_message` source used to associate streamed assistant events with turns.

The optimistic source entry uses the same message ID passed to prompt admission. A promoted input with that ID confirms the existing entry instead of adding another one. If admission fails before confirmation, removing the optimistic message also removes its source entry.

This makes the current user message the active parent before any assistant step, reasoning, text, or tool event arrives.

### Stop Semantics

An empty submission is always a no-op, including while execution is active. It must not call the interrupt endpoint.

Execution remains stoppable through explicit controls:

- the visible stop button;
- `Escape`;
- `Ctrl+G`.

This separates send and stop intent and prevents a duplicate Enter/form submission after the editor is cleared from canceling a new execution.

## Scope

Change only optimistic session projection and prompt submission behavior. Do not change the backend runner, provider calls, prompt delivery modes, model configuration, or timeout policy.

## Failure Handling

If prompt admission fails, remove the unconfirmed optimistic message from normalized caches and the V2 source, then restore the editor as today. Once server events confirm the message, later cleanup must not remove durable source data.

## Verification

- A store test proves an optimistic second-turn user entry precedes a streamed assistant event and becomes its parent.
- A store test proves an unconfirmed optimistic source entry is removed on submission rollback.
- A submit test proves an empty submission during active execution does not interrupt.
- Existing explicit interrupt tests continue to pass.
- A live three-turn private-model conversation keeps every streamed response below its matching user message and does not lose the second turn.

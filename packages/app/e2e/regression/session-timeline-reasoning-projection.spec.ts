import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  reasoningPart,
  setupTimeline,
  status,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const profiles = [
  {
    name: "summaries off no reasoning",
    summaries: false,
    reasoning: "",
    other: false,
    process: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries off reasoning heading",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: false,
    process: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries off with visible tool",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: true,
    process: true,
    thinking: false,
    body: false,
  },
  {
    name: "summaries on no content",
    summaries: true,
    reasoning: "",
    other: false,
    process: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries on blank reasoning",
    summaries: true,
    reasoning: "   ",
    other: false,
    process: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries on visible reasoning",
    summaries: true,
    reasoning: "## Inspecting stability",
    other: false,
    process: true,
    thinking: false,
    body: true,
  },
  {
    name: "summaries on visible tool no reasoning",
    summaries: true,
    reasoning: "",
    other: true,
    process: true,
    thinking: false,
    body: false,
  },
] as const

for (const profile of profiles) {
  test(`projects busy reasoning profile ${profile.name}`, async ({ page }) => {
    const reasoningID = `prt_reasoning_matrix_${profiles.indexOf(profile)}`
    const toolID = `prt_reasoning_tool_${profiles.indexOf(profile)}`
    const parts = [
      ...(profile.reasoning ? [reasoningPart(reasoningID, profile.reasoning)] : []),
      ...(profile.other ? [toolPart(toolID, "skill", "running", { name: "inspect" })] : []),
    ]
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage(parts, { completed: false })],
      settings: { showReasoningSummaries: profile.summaries },
    })
    await timeline.send(status("busy"), 150)

    const process = page.locator('[data-slot="session-turn-process-trigger"]').first()
    await expect(process).toHaveCount(profile.process ? 1 : 0)
    if (profile.process) {
      await expect(process).toHaveAttribute("aria-expanded", "false")
      await process.click()
      await expect(process).toHaveAttribute("aria-expanded", "true")
    }
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(profile.thinking ? 1 : 0)
    await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(profile.body ? 1 : 0)
    await expect(page.locator(`[data-timeline-part-id="${toolID}"]`)).toHaveCount(profile.other ? 1 : 0)
    if (profile.thinking && !profile.summaries && profile.reasoning.trim()) {
      await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
    }
  })
}

test("does not infer reasoning visibility from provider identity", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_provider_text", "No reasoning payload")], { completed: false }),
    ],
    settings: { showReasoningSummaries: true },
  })
  await timeline.send(status("busy"), 150)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id*="reasoning"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id="prt_provider_text"]')).toBeVisible()
})

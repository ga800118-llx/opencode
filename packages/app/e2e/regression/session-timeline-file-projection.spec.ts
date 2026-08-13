import { expect, test, type Page } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

test("renders completed write content", async ({ page }) => {
  const id = "prt_file_projection_write"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(id, "write", "completed", { filePath: "src/write.ts", content: "export const written = true\n" }),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })

  await expandProcess(page)
  await expandPart(page, id)
  await expect(page.locator(`[data-timeline-part-id="${id}"] [data-component="write-content"]`)).toBeVisible()
})

test("renders a completed single-file patch", async ({ page }) => {
  const id = "prt_file_projection_single_patch"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          id,
          "apply_patch",
          "completed",
          { files: ["src/a.ts"] },
          {
            metadata: {
              files: [
                {
                  filePath: "src/a.ts",
                  relativePath: "src/a.ts",
                  type: "update",
                  additions: 1,
                  deletions: 1,
                  before: "export const value = 1\n",
                  after: "export const value = 2\n",
                },
              ],
            },
          },
        ),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })

  await expandProcess(page)
  await expandPart(page, id)
  await expect(page.locator(`[data-timeline-part-id="${id}"] [data-component="apply-patch-file-diff"]`)).toBeVisible()
})

async function expandProcess(page: Page) {
  const trigger = page.locator('[data-slot="session-turn-process-trigger"]').first()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
}

async function expandPart(page: Page, id: string) {
  const trigger = page.locator(`[data-timeline-part-id="${id}"] [data-slot="collapsible-trigger"]`).first()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
}

import { expect, test } from "@playwright/test"
import { assistantMessage, partDelta, setupTimeline, textPart, userMessage } from "./fixture"

type ResizeObserverErrorWindow = Window & { __timelineResizeObserverErrors: string[] }

test("does not report ResizeObserver loops while streamed text resizes the timeline", async ({ page }) => {
  const partID = "prt_resize_observer_stream"
  await page.addInitScript(() => {
    const target = window as ResizeObserverErrorWindow
    target.__timelineResizeObserverErrors = []
    window.addEventListener("error", (event) => {
      if (!event.message.includes("ResizeObserver loop")) return
      target.__timelineResizeObserverErrors.push(event.message)
    })
  })
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart(partID, "## Streaming response")], { completed: false })],
    cpuRate: 4,
  })

  const chunks = [
    ...Array.from(
      { length: 20 },
      (_, index) =>
        `\n\n### Layout pass ${index + 1}\n\n${"Virtual rows must remeasure when streamed Markdown wraps across the available width and adds another visible line. ".repeat(6)}`,
    ),
    "\n\n```ts",
    ...Array.from(
      { length: 48 },
      (_, index) =>
        `\nconst measurement${index + 1} = calculateLayout({ row: ${index + 1}, width: 1181, content: "streamed code line" })`,
    ),
    "\n```",
    "\n\nFinal paragraph keeps the tall assistant response incomplete while layout settles.",
  ]
  for (const chunk of chunks) await timeline.send(partDelta(partID, chunk), 20)

  const part = page.locator(`[data-timeline-part-id="${partID}"]`)
  await expect(part).toContainText("Final paragraph")
  await timeline.settle(8)

  const rowHeight = await part.evaluate(
    (element) => element.closest<HTMLElement>('[data-timeline-row="AssistantPart"]')?.getBoundingClientRect().height ?? 0,
  )
  expect(rowHeight, "streamed assistant row did not exceed the Electron reproduction height").toBeGreaterThan(3800)
  const resizeObserverErrors = await page.evaluate(
    () => (window as ResizeObserverErrorWindow).__timelineResizeObserverErrors,
  )
  expect(
    resizeObserverErrors,
    `captured ${resizeObserverErrors.length} ResizeObserver loop errors after the row reached ${rowHeight}px`,
  ).toEqual([])
})

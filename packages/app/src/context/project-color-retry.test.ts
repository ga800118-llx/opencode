import { describe, expect, test } from "bun:test"
import { createProjectColorRetryController } from "./project-color-retry"

function createTimer() {
  const scheduled = new Map<number, { run: () => void; delay: number }>()
  const cancelled: number[] = []
  let id = 0

  return {
    scheduled,
    cancelled,
    schedule(run: () => void, delay: number) {
      id += 1
      scheduled.set(id, { run, delay })
      return id
    },
    cancel(timer: unknown) {
      const value = timer as number
      cancelled.push(value)
      scheduled.delete(value)
    },
    run(timer: number) {
      const task = scheduled.get(timer)
      if (!task) throw new Error("scheduled retry required")
      scheduled.delete(timer)
      task.run()
    },
  }
}

describe("createProjectColorRetryController", () => {
  test("retries twice at one and two seconds, then stops", () => {
    const timer = createTimer()
    const retries: string[] = []
    const controller = createProjectColorRetryController({
      retry: (worktree) => retries.push(worktree),
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    expect(controller.failed("/project")).toBe(true)
    expect(timer.scheduled.get(1)?.delay).toBe(1_000)
    expect(controller.canAttempt("/project")).toBe(false)
    timer.run(1)
    expect(retries).toEqual(["/project"])
    expect(controller.canAttempt("/project")).toBe(true)

    expect(controller.failed("/project")).toBe(true)
    expect(timer.scheduled.get(2)?.delay).toBe(2_000)
    timer.run(2)
    expect(retries).toEqual(["/project", "/project"])

    expect(controller.failed("/project")).toBe(false)
    expect(controller.canAttempt("/project")).toBe(false)
    expect(timer.scheduled.size).toBe(0)
  })

  test("success clears a scheduled retry", () => {
    const timer = createTimer()
    const retries: string[] = []
    const controller = createProjectColorRetryController({
      retry: (worktree) => retries.push(worktree),
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    controller.failed("/project")
    controller.clear("/project")

    expect(controller.has("/project")).toBe(false)
    expect(timer.cancelled).toEqual([1])
    expect(retries).toEqual([])
  })

  test("clear resets the retry budget", () => {
    const timer = createTimer()
    const controller = createProjectColorRetryController({
      retry: () => {},
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    controller.failed("/project")
    timer.run(1)
    controller.failed("/project")
    expect(timer.scheduled.get(2)?.delay).toBe(2_000)

    controller.clear("/project")
    controller.failed("/project")

    expect(timer.cancelled).toEqual([2])
    expect(timer.scheduled.get(3)?.delay).toBe(1_000)
  })

  test("dispose clears every pending timer", () => {
    const timer = createTimer()
    const controller = createProjectColorRetryController({
      retry: () => {},
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    controller.failed("/one")
    controller.failed("/two")
    controller.dispose()

    expect(timer.scheduled.size).toBe(0)
    expect(timer.cancelled).toEqual([1, 2])
  })
})

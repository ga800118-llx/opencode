import { expect, test } from "bun:test"
import { synchronizeApplicationLocale } from "./application-locale-sync"

test("reports a rejected native locale update without rejecting", async () => {
  const failure = new Error("ipc failed")
  const warnings: Array<{ message: string; error: unknown }> = []

  await expect(
    synchronizeApplicationLocale(
      "zh",
      () => Promise.reject(failure),
      (message, error) => warnings.push({ message, error }),
    ),
  ).resolves.toBeUndefined()
  expect(warnings).toEqual([
    {
      message: 'Failed to synchronize native application locale "zh".',
      error: failure,
    },
  ])
})

test("reports a synchronous native locale failure without rejecting", async () => {
  const failure = new Error("bridge unavailable")
  const warnings: Array<{ message: string; error: unknown }> = []

  await expect(
    synchronizeApplicationLocale(
      "zht",
      () => {
        throw failure
      },
      (message, error) => warnings.push({ message, error }),
    ),
  ).resolves.toBeUndefined()
  expect(warnings).toEqual([
    {
      message: 'Failed to synchronize native application locale "zht".',
      error: failure,
    },
  ])
})

test("does not warn after a successful native locale update", async () => {
  const locales: string[] = []
  const warnings: string[] = []

  await synchronizeApplicationLocale(
    "zh",
    () => {
      locales.push("zh")
    },
    (message) => warnings.push(message),
  )

  expect(locales).toEqual(["zh"])
  expect(warnings).toEqual([])
})

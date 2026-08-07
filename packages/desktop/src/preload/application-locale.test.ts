import { expect, test } from "bun:test"
import { APPLICATION_LOCALE_CHANNEL, createApplicationLocaleSetter } from "./application-locale"

test("invokes the fixed application locale channel and resolves void", async () => {
  const calls: Array<{ channel: string; locale: string }> = []
  const setApplicationLocale = createApplicationLocaleSetter(async (channel, locale) => {
    calls.push({ channel, locale })
    return "ignored"
  })

  await expect(setApplicationLocale("zh-CN")).resolves.toBeUndefined()
  expect(APPLICATION_LOCALE_CHANNEL).toBe("set-application-locale")
  expect(calls).toEqual([{ channel: "set-application-locale", locale: "zh-CN" }])
})

test("preserves invoke failures", async () => {
  const failure = new Error("invoke failed")
  const setApplicationLocale = createApplicationLocaleSetter(() => Promise.reject(failure))

  await expect(setApplicationLocale("zh")).rejects.toBe(failure)
})

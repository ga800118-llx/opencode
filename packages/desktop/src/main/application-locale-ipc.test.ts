import { expect, test } from "bun:test"
import { registerApplicationLocaleIpc } from "./application-locale-ipc"

test("registers the fixed channel and forwards the raw locale", async () => {
  const locales: string[] = []
  const registrations: Array<{ channel: string; listener: (locale: string) => Promise<void> | void }> = []
  registerApplicationLocaleIpc(
    (channel, listener) => registrations.push({ channel, listener }),
    (locale) => {
      locales.push(locale)
    },
  )

  expect(registrations.map((registration) => registration.channel)).toEqual(["set-application-locale"])
  await registrations[0]?.listener("zh-Hans-CN")
  expect(locales).toEqual(["zh-Hans-CN"])
})

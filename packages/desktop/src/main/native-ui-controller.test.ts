import { expect, test } from "bun:test"
import type { DesktopMenuLocale } from "@opencode-ai/app/desktop-menu"
import { createNativeUiController } from "./native-ui-controller"

function createRecorder(initialLocale: string) {
  const menus: DesktopMenuLocale[] = []
  const contexts: DesktopMenuLocale[] = []
  const disposed: DesktopMenuLocale[] = []
  const controller = createNativeUiController({
    initialLocale,
    installApplicationMenu: (locale) => menus.push(locale),
    installContextMenu: (locale) => {
      contexts.push(locale)
      return () => disposed.push(locale)
    },
  })

  return { controller, menus, contexts, disposed }
}

test("rebuilds native surfaces once per actual locale change", () => {
  const recorded = createRecorder("en")

  recorded.controller.start()
  recorded.controller.start()
  recorded.controller.enableApplicationMenu()
  recorded.controller.enableApplicationMenu()
  recorded.controller.setLocale("zh")
  recorded.controller.setLocale("zh")

  expect(recorded.contexts).toEqual(["en", "zh"])
  expect(recorded.disposed).toEqual(["en"])
  expect(recorded.menus).toEqual(["en", "zh"])
})

test("normalizes BCP 47 Chinese locales", () => {
  const recorded = createRecorder("zh-CN")

  recorded.controller.start()
  recorded.controller.enableApplicationMenu()
  recorded.controller.setLocale("zh-TW")

  expect(recorded.contexts).toEqual(["zh", "zht"])
  expect(recorded.disposed).toEqual(["zh"])
  expect(recorded.menus).toEqual(["zh", "zht"])
})

test("deduplicates unsupported locale fallbacks", () => {
  const recorded = createRecorder("fr-FR")

  recorded.controller.start()
  recorded.controller.enableApplicationMenu()
  recorded.controller.setLocale("de-DE")
  recorded.controller.setLocale("zh")
  recorded.controller.setLocale("es-ES")
  recorded.controller.setLocale("pt-BR")

  expect(recorded.contexts).toEqual(["en", "zh", "en"])
  expect(recorded.disposed).toEqual(["en", "zh"])
  expect(recorded.menus).toEqual(["en", "zh", "en"])
})

test("disposes the context menu idempotently without rebuilding the application menu", () => {
  const recorded = createRecorder("en")

  recorded.controller.start()
  recorded.controller.enableApplicationMenu()
  recorded.controller.dispose()
  recorded.controller.dispose()

  expect(recorded.contexts).toEqual(["en"])
  expect(recorded.disposed).toEqual(["en"])
  expect(recorded.menus).toEqual(["en"])
})

test("uses a locale changed before start when installing the context menu", () => {
  const recorded = createRecorder("en")

  recorded.controller.setLocale("zh-CN")
  expect(recorded.contexts).toEqual([])
  expect(recorded.menus).toEqual([])

  recorded.controller.start()

  expect(recorded.contexts).toEqual(["zh"])
  expect(recorded.disposed).toEqual([])
})

test("can restart after disposal", () => {
  const recorded = createRecorder("en")

  recorded.controller.start()
  recorded.controller.enableApplicationMenu()
  recorded.controller.dispose()
  recorded.controller.start()

  expect(recorded.contexts).toEqual(["en", "en"])
  expect(recorded.disposed).toEqual(["en"])
  expect(recorded.menus).toEqual(["en", "en"])
})

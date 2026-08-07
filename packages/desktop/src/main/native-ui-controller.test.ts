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

test("retries start after context-menu installation fails", () => {
  const contexts: DesktopMenuLocale[] = []
  const disposed: DesktopMenuLocale[] = []
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: () => undefined,
    installContextMenu: (locale) => {
      contexts.push(locale)
      if (contexts.length === 1) throw new Error("context install failed")
      return () => disposed.push(locale)
    },
  })

  expect(() => controller.start()).toThrow("context install failed")
  controller.start()
  controller.start()
  controller.dispose()

  expect(contexts).toEqual(["en", "en"])
  expect(disposed).toEqual(["en"])
})

test("retries enabling the application menu after installation fails", () => {
  const menus: DesktopMenuLocale[] = []
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: (locale) => {
      menus.push(locale)
      if (menus.length === 1) throw new Error("menu install failed")
    },
    installContextMenu: () => () => undefined,
  })

  expect(() => controller.enableApplicationMenu()).toThrow("menu install failed")
  controller.enableApplicationMenu()
  controller.enableApplicationMenu()

  expect(menus).toEqual(["en", "en"])
})

test("keeps the current locale when replacement context installation fails", () => {
  const contexts: DesktopMenuLocale[] = []
  const menus: DesktopMenuLocale[] = []
  const disposed: DesktopMenuLocale[] = []
  let failed = false
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: (locale) => menus.push(locale),
    installContextMenu: (locale) => {
      contexts.push(locale)
      if (locale === "zh" && !failed) {
        failed = true
        throw new Error("replacement context failed")
      }
      return () => disposed.push(locale)
    },
  })

  controller.start()
  controller.enableApplicationMenu()
  expect(() => controller.setLocale("zh-CN")).toThrow("replacement context failed")
  expect(contexts).toEqual(["en", "zh"])
  expect(menus).toEqual(["en"])
  expect(disposed).toEqual([])

  controller.setLocale("zh-CN")
  controller.setLocale("zh")
  controller.dispose()

  expect(contexts).toEqual(["en", "zh", "zh"])
  expect(menus).toEqual(["en", "zh"])
  expect(disposed).toEqual(["en", "zh"])
})

test("cleans replacement context and restores the current menu when menu installation fails", () => {
  const contexts: DesktopMenuLocale[] = []
  const menus: DesktopMenuLocale[] = []
  const disposed: DesktopMenuLocale[] = []
  let failed = false
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: (locale) => {
      menus.push(locale)
      if (locale === "zh" && !failed) {
        failed = true
        throw new Error("replacement menu failed")
      }
    },
    installContextMenu: (locale) => {
      contexts.push(locale)
      return () => disposed.push(locale)
    },
  })

  controller.start()
  controller.enableApplicationMenu()
  expect(() => controller.setLocale("zh")).toThrow("replacement menu failed")
  expect(contexts).toEqual(["en", "zh"])
  expect(menus).toEqual(["en", "zh", "en"])
  expect(disposed).toEqual(["zh"])

  controller.setLocale("zh")
  controller.setLocale("zh-CN")
  controller.dispose()

  expect(contexts).toEqual(["en", "zh", "zh"])
  expect(menus).toEqual(["en", "zh", "en", "zh"])
  expect(disposed).toEqual(["zh", "en", "zh"])
})

test("aggregates replacement install, cleanup, and restore failures without committing locale", () => {
  const installError = new Error("replacement menu failed")
  const cleanupError = new Error("replacement cleanup failed")
  const restoreError = new Error("current menu restore failed")
  const contexts: DesktopMenuLocale[] = []
  const menus: DesktopMenuLocale[] = []
  const disposed: DesktopMenuLocale[] = []
  let failuresEnabled = false
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: (locale) => {
      menus.push(locale)
      if (!failuresEnabled) return
      if (locale === "zh") throw installError
      throw restoreError
    },
    installContextMenu: (locale) => {
      contexts.push(locale)
      return () => {
        disposed.push(locale)
        if (failuresEnabled && locale === "zh") throw cleanupError
      }
    },
  })

  controller.start()
  controller.enableApplicationMenu()
  failuresEnabled = true
  const failure = (() => {
    try {
      controller.setLocale("zh")
    } catch (error) {
      return error
    }
  })()

  expect(failure).toBeInstanceOf(AggregateError)
  if (!(failure instanceof AggregateError)) throw new Error("expected AggregateError")
  expect(failure.errors).toHaveLength(3)
  expect(failure.errors[0]).toBe(installError)
  expect(failure.errors[1]).toBe(cleanupError)
  expect(failure.errors[2]).toBe(restoreError)
  expect(failure.message).toContain("zh")

  controller.setLocale("en")
  expect(contexts).toEqual(["en", "zh"])
  expect(menus).toEqual(["en", "zh", "en"])
  expect(disposed).toEqual(["zh"])

  failuresEnabled = false
  controller.setLocale("zh")
  controller.setLocale("zh-CN")
  controller.dispose()

  expect(contexts).toEqual(["en", "zh", "zh"])
  expect(menus).toEqual(["en", "zh", "en", "zh"])
  expect(disposed).toEqual(["zh", "en", "zh"])
})

test("commits the replacement before calling an old disposer that fails", () => {
  const contexts: DesktopMenuLocale[] = []
  const disposed: DesktopMenuLocale[] = []
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: () => undefined,
    installContextMenu: (locale) => {
      contexts.push(locale)
      return () => {
        disposed.push(locale)
        if (locale === "en") throw new Error("old dispose failed")
      }
    },
  })

  controller.start()
  expect(() => controller.setLocale("zh")).toThrow("old dispose failed")
  controller.setLocale("zh-CN")
  controller.setLocale("zh-TW")
  controller.dispose()

  expect(contexts).toEqual(["en", "zh", "zht"])
  expect(disposed).toEqual(["en", "zh", "zht"])
})

test("clears stopped state before calling a disposer that fails", () => {
  const contexts: DesktopMenuLocale[] = []
  const disposed: string[] = []
  let installation = 0
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: () => undefined,
    installContextMenu: (locale) => {
      contexts.push(locale)
      const id = ++installation
      return () => {
        disposed.push(`${locale}:${id}`)
        if (id === 1) throw new Error("dispose failed")
      }
    },
  })

  controller.start()
  expect(() => controller.dispose()).toThrow("dispose failed")
  controller.dispose()
  controller.start()
  controller.dispose()

  expect(contexts).toEqual(["en", "en"])
  expect(disposed).toEqual(["en:1", "en:2"])
})

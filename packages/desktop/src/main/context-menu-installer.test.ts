import { expect, test } from "bun:test"
import type { Labels } from "electron-context-menu"
import { createContextMenuLabels } from "./context-menu-labels"
import { createContextMenuInstaller } from "./context-menu-installer"
import { createNativeUiController } from "./native-ui-controller"

function createRecorder() {
  const registrations: Required<Labels>[] = []
  const disposed: Required<Labels>[] = []
  const install = createContextMenuInstaller({
    createLabels: createContextMenuLabels,
    register: (labels) => {
      registrations.push(labels)
      return () => disposed.push(labels)
    },
  })

  return { install, registrations, disposed }
}

test("registers once and updates the same labels object across locale changes", () => {
  const recorded = createRecorder()

  const disposeEnglish = recorded.install("en")
  const labels = recorded.registrations[0]
  const disposeChinese = recorded.install("zh")
  disposeEnglish()
  const disposeTraditionalChinese = recorded.install("zht")
  disposeChinese()

  expect(recorded.registrations).toHaveLength(1)
  expect(recorded.registrations[0]).toBe(labels)
  expect(labels?.copy).toBe("複製")
  expect(recorded.disposed).toEqual([])

  disposeTraditionalChinese()
  expect(recorded.disposed).toEqual([labels])
})

test("disposing the previous lease after a successful switch preserves current labels", () => {
  const recorded = createRecorder()

  const disposeEnglish = recorded.install("en")
  const disposeChinese = recorded.install("zh")
  disposeEnglish()

  expect(recorded.registrations[0]?.copy).toBe("复制")
  expect(recorded.disposed).toEqual([])

  disposeChinese()
})

test("disposing a replacement lease rolls back to the previous active labels", () => {
  const recorded = createRecorder()

  const disposeEnglish = recorded.install("en")
  const disposeChinese = recorded.install("zh")
  expect(recorded.registrations[0]?.copy).toBe("复制")

  disposeChinese()
  expect(recorded.registrations[0]?.copy).toBe("Copy")
  expect(recorded.disposed).toEqual([])

  disposeEnglish()
})

test("controller failure cleanup rolls back the replacement lease", () => {
  const recorded = createRecorder()
  const controller = createNativeUiController({
    initialLocale: "en",
    installApplicationMenu: (locale) => {
      if (locale === "zh") throw new Error("application menu failed")
    },
    installContextMenu: recorded.install,
  })

  controller.start()
  controller.enableApplicationMenu()
  expect(() => controller.setLocale("zh")).toThrow("application menu failed")

  expect(recorded.registrations).toHaveLength(1)
  expect(recorded.registrations[0]?.copy).toBe("Copy")
  expect(recorded.disposed).toEqual([])

  controller.dispose()
  expect(recorded.disposed).toEqual(recorded.registrations)
})

test("final disposal releases once and allows a new registration lifecycle", () => {
  const recorded = createRecorder()

  const disposeEnglish = recorded.install("en")
  disposeEnglish()
  disposeEnglish()

  expect(recorded.registrations).toHaveLength(1)
  expect(recorded.disposed).toHaveLength(1)

  const disposeChinese = recorded.install("zh")
  expect(recorded.registrations).toHaveLength(2)
  expect(recorded.registrations[1]?.copy).toBe("复制")

  disposeChinese()
  disposeChinese()
  expect(recorded.disposed).toEqual(recorded.registrations)
})

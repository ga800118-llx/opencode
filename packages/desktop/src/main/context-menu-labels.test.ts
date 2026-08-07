import { expect, test } from "bun:test"
import { createContextMenuLabels } from "./context-menu-labels"

const simplifiedChineseLabels = {
  learnSpelling: "学习拼写",
  lookUpSelection: "查询“{selection}”",
  searchWithGoogle: "使用 Google 搜索",
  cut: "剪切",
  copy: "复制",
  paste: "粘贴",
  selectAll: "全选",
  saveImage: "保存图像",
  saveImageAs: "图像另存为...",
  saveVideo: "保存视频",
  saveVideoAs: "视频另存为...",
  copyLink: "复制链接",
  saveLinkAs: "链接另存为...",
  copyImage: "复制图像",
  copyImageAddress: "复制图像地址",
  copyVideoAddress: "复制视频地址",
  inspect: "检查元素",
  services: "服务",
}

test("provides every supported Simplified Chinese context-menu label", () => {
  expect(createContextMenuLabels("zh")).toEqual(simplifiedChineseLabels)
})

test("provides the same complete key set for every supported locale", () => {
  const keys = Object.keys(simplifiedChineseLabels)

  expect(Object.keys(createContextMenuLabels("en"))).toEqual(keys)
  expect(Object.keys(createContextMenuLabels("zht"))).toEqual(keys)
})

test("provides representative English and Traditional Chinese labels", () => {
  expect(createContextMenuLabels("en")).toMatchObject({
    cut: "Cut",
    paste: "Paste",
    saveVideoAs: "Save Video As…",
    copyImageAddress: "Copy Image Address",
    services: "Services",
  })
  expect(createContextMenuLabels("zht")).toMatchObject({
    cut: "剪下",
    paste: "貼上",
    saveVideoAs: "影片另存為...",
    copyImageAddress: "複製圖像位址",
    services: "服務",
  })
})

test("falls back to English for unsupported locales", () => {
  expect(createContextMenuLabels("fr-FR")).toEqual(createContextMenuLabels("en"))
})

test("preserves the selection placeholder in every supported locale", () => {
  expect(
    ["en", "zh", "zht"].map((locale) => createContextMenuLabels(locale).lookUpSelection.includes("{selection}")),
  ).toEqual([true, true, true])
})

test("returns an isolated labels object", () => {
  const first = createContextMenuLabels("zh")
  Object.assign(first, { copy: "changed" })

  expect(first.copy).toBe("changed")
  expect(createContextMenuLabels("zh").copy).toBe("复制")
})

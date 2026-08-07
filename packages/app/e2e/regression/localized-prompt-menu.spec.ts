import { expect, test } from "@playwright/test"

test("shows a fully localized Simplified Chinese prompt add menu", async ({ page }) => {
  await page.goto("/e2e/fixtures/localized-prompt-menu/")

  await expect(page.getByRole("textbox")).toHaveAccessibleName("Prompt")
  await expect(page.getByRole("button", { name: "Remove attachment" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Remove file from context" })).toBeVisible()
  await page.getByRole("button", { name: "Add files and more" }).click()
  await expect(page.getByRole("menuitem")).toHaveText([
    "Images and filesMod+U",
    "Commands/",
    "Context@",
    "Shell command!",
  ])
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "简体中文" }).click()
  await expect(page.getByRole("textbox")).toHaveAccessibleName("提示词")
  await expect(page.getByRole("button", { name: "移除附件" })).toBeVisible()
  await expect(page.getByRole("button", { name: "从上下文移除文件" })).toBeVisible()
  await page.getByRole("button", { name: "添加文件及更多内容" }).click()
  await expect(page.getByRole("menuitem")).toHaveText(["图片和文件Mod+U", "命令/", "上下文@", "Shell 命令!"])
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Shell 模式" }).click()
  await expect(page.getByRole("textbox")).toHaveAccessibleName("Shell 命令")
})

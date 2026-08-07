import { expect, test } from "@playwright/test"

test("shows a fully localized Simplified Chinese prompt add menu", async ({ page }) => {
  await page.goto("/e2e/fixtures/localized-prompt-menu/")
  await page.getByRole("button", { name: "添加文件及更多内容" }).click()
  await expect(page.getByRole("menuitem")).toHaveText(["图片和文件", "命令/", "上下文@", "Shell 命令!"])
})

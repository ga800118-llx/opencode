import { expect, test } from "bun:test"
import { modelCenterEn, modelCenterZh } from "./model-center-copy"

test("describes the default as the model selected for new tasks", () => {
  expect(modelCenterEn["settings.modelCenter.default.emptyDescription"]).toBe(
    "Choose the model to use by default for new tasks.",
  )
  expect(modelCenterZh["settings.modelCenter.default.emptyDescription"]).toBe("选择新任务默认使用的模型。")
})

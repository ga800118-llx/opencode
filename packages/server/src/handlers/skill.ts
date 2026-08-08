import { SkillV2 } from "@opencode-ai/core/skill"
import {
  SkillManagementForbiddenError,
  SkillManagementNotFoundError,
  SkillManagementOperationError,
} from "@opencode-ai/protocol/groups/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers
    .handle("skill.list", () => response(SkillV2.Service.use((skill) => skill.list())))
    .handle("skill.management.list", () => response(SkillV2.Service.use((skill) => skill.management.list())))
    .handle("skill.management.setEnabled", (ctx) =>
      response(
        SkillV2.Service.use((skill) => skill.management.setEnabled(ctx.params.id, ctx.payload.enabled)).pipe(
          Effect.mapError(setEnabledError),
        ),
      ),
    )
    .handle("skill.management.remove", (ctx) =>
      response(
        SkillV2.Service.use((skill) => skill.management.remove(ctx.params.id)).pipe(Effect.mapError(managementError)),
      ),
    ),
)

function setEnabledError(error: SkillV2.NotFoundError | SkillV2.OperationError) {
  if (error._tag === "SkillV2.NotFoundError") {
    return new SkillManagementNotFoundError({ id: error.id, message: "Skill installation not found." })
  }
  return new SkillManagementOperationError({
    operation: error.operation,
    message: "Skill management operation failed.",
  })
}

function managementError(error: SkillV2.ManagementError) {
  if (error._tag === "SkillV2.NotFoundError") return setEnabledError(error)
  if (error._tag === "SkillV2.ProtectedError" || error._tag === "SkillV2.UnsafePathError") {
    return new SkillManagementForbiddenError({
      id: error.id,
      reason: error.reason,
      message: "Skill cannot be deleted.",
    })
  }
  return setEnabledError(error)
}

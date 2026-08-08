import { Skill } from "@opencode-ai/schema/skill"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export class SkillManagementNotFoundError extends Schema.TaggedErrorClass<SkillManagementNotFoundError>()(
  "SkillManagementNotFoundError",
  { id: Skill.ManagementID, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class SkillManagementForbiddenError extends Schema.TaggedErrorClass<SkillManagementForbiddenError>()(
  "SkillManagementForbiddenError",
  { id: Skill.ManagementID, reason: Skill.DeleteBlocked, message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class SkillManagementOperationError extends Schema.TaggedErrorClass<SkillManagementOperationError>()(
  "SkillManagementOperationError",
  { operation: Schema.Literals(["read", "write", "delete"]), message: Schema.String },
  { httpApiStatus: 500 },
) {}

export const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("skill.management.list", "/api/skill/management", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.ManagementInfo)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.management.list",
          summary: "List Skill installations",
          description: "Retrieve all discovered Skill installations and their management state.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("skill.management.setEnabled", "/api/skill/management/:id", {
      params: { id: Skill.ManagementID },
      query: LocationQuery,
      payload: Skill.SetEnabledInput,
      success: Location.response(Schema.Array(Skill.ManagementInfo)),
      error: [SkillManagementNotFoundError, SkillManagementOperationError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.management.setEnabled",
          summary: "Set Skill installation state",
          description: "Enable or disable a discovered Skill installation.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("skill.management.remove", "/api/skill/management/:id", {
      params: { id: Skill.ManagementID },
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.ManagementInfo)),
      error: [SkillManagementNotFoundError, SkillManagementForbiddenError, SkillManagementOperationError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.management.remove",
          summary: "Remove a Skill installation",
          description: "Move a user-owned local Skill installation into the recovery area.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skills",
      description: "Experimental skill routes.",
    }),
  )

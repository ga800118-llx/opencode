import { afterEach, describe, expect, test } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { statePaths } from "@opencode-ai/core/skill/management"
import { Context, Schema } from "effect"
import fs from "fs/promises"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>
Global.Path.state = await fs.realpath(Global.Path.state)

function request(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

const Event = Schema.Struct({
  id: EventV2.ID,
  type: Schema.String,
  location: Schema.optional(Location.Ref),
  data: Schema.Unknown,
})

const ManagementResponse = Schema.Struct({
  location: Location.Info,
  data: Schema.Array(SkillV2.ManagementInfo),
})

async function* eventStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const boundary = buffer.match(/(?:\r\n|\r|\n){2}/)
      if (!boundary || boundary.index === undefined) {
        const value = await reader.read()
        if (value.done) return
        buffer += decoder.decode(value.value, { stream: true })
        continue
      }

      const record = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length)
      const data = record
        .split(/\r\n|\r|\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
      if (data.length) yield Schema.decodeUnknownSync(Event)(JSON.parse(data.join("\n")))
    }
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}

async function readEvent(reader: AsyncIterator<typeof Event.Type>) {
  const value = await reader.next()
  if (value.done) throw new Error("event stream closed")
  return value.value
}

async function readEventType(reader: AsyncIterator<typeof Event.Type>, type: string) {
  for (let index = 0; index < 20; index++) {
    const event = await readEvent(reader)
    if (event.type === type) return event
  }
  throw new Error(`timed out waiting for ${type}`)
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 location HttpApi", () => {
  test("decodes EventV2 location refs without resolved project metadata", () => {
    expect(
      Schema.decodeUnknownSync(Event)({
        id: "evt_test",
        type: "file.watcher.updated",
        location: { directory: "/tmp/project" },
        data: {},
      }),
    ).toMatchObject({ location: { directory: "/tmp/project" } })
  })

  test("returns command and skill snapshots with resolved locations", async () => {
    await using tmp = await tmpdir({ git: true })

    for (const route of ["/api/command", "/api/skill", "/api/skill/management"]) {
      const response = await request(route, tmp.path)
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        location: { directory: string; project: { id: string } }
        data: unknown
      }
      expect(body.data).toBeArray()
      expect(body.location.directory).toBe(tmp.path)
      expect(body.location.project.id).toBeTruthy()
    }
  })

  test("manages a disposable local Skill through location-scoped HTTP routes", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        const skill = path.join(directory, ".opencode", "skills", "http-management-fixture")
        await fs.mkdir(skill, { recursive: true })
        await Bun.write(
          path.join(skill, "SKILL.md"),
          "---\nname: http-management-fixture\ndescription: Disposable HTTP management fixture.\n---\nFixture.\n",
        )
        return skill
      },
    })

    const listed = await request("/api/skill/management", tmp.path)
    expect(listed.status).toBe(200)
    const initial = Schema.decodeUnknownSync(ManagementResponse)(await listed.json())
    const installation = initial.data.find((entry) => entry.name === "http-management-fixture")
    expect(installation).toBeDefined()
    expect(installation).toMatchObject(
      installation!.deletable ? { deletable: true } : { deletable: false, deleteBlocked: "unsafe" },
    )
    expect(initial.location.directory).toBe(AbsolutePath.make(tmp.path))

    const disabled = await request(`/api/skill/management/${installation!.id}`, tmp.path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    expect(disabled.status).toBe(200)
    const disabledBody = Schema.decodeUnknownSync(ManagementResponse)(await disabled.json())
    expect(disabledBody.location.directory).toBe(AbsolutePath.make(tmp.path))
    expect(disabledBody.data.find((entry) => entry.id === installation!.id)).toMatchObject({
      enabled: false,
      status: "disabled",
    })

    const removed = await request(`/api/skill/management/${installation!.id}`, tmp.path, { method: "DELETE" })
    if (!installation!.deletable) {
      expect(removed.status).toBe(403)
      expect(await removed.json()).toEqual({
        _tag: "SkillManagementForbiddenError",
        id: installation!.id,
        reason: "unsafe",
        message: "Skill cannot be deleted.",
      })
      expect(await fs.stat(tmp.extra)).toBeDefined()
      expect(await fs.stat(path.join(tmp.extra, "SKILL.md"))).toBeDefined()
      return
    }

    expect(removed.status).toBe(200)
    const removedBody = Schema.decodeUnknownSync(ManagementResponse)(await removed.json())
    expect(removedBody.location.directory).toBe(AbsolutePath.make(tmp.path))
    expect(removedBody.data.some((entry) => entry.id === installation!.id)).toBe(false)
    expect(await fs.stat(tmp.extra).catch(() => undefined)).toBeUndefined()

    const records = await fs.readdir(path.join(Global.Path.state, "skills", "trash"))
    const recovery = records.find((record) => record.includes(installation!.id.slice(0, 12)))
    expect(recovery).toBeDefined()
    const metadata = path.join(Global.Path.state, "skills", "trash", recovery!, "metadata.json")
    expect((await fs.stat(metadata)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await Bun.file(metadata).text())).toMatchObject({ id: installation!.id, originalPath: tmp.extra })
    expect(await fs.stat(path.join(Global.Path.state, "skills", "trash", recovery!, "payload"))).toBeDefined()
  })

  test("returns typed safe management errors", async () => {
    await using tmp = await tmpdir({ git: true })
    const missingID = "f".repeat(64)
    const missing = await request(`/api/skill/management/${missingID}`, tmp.path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      _tag: "SkillManagementNotFoundError",
      id: missingID,
      message: "Skill installation not found.",
    })
    const missingDelete = await request(`/api/skill/management/${missingID}`, tmp.path, { method: "DELETE" })
    expect(missingDelete.status).toBe(404)
    expect(await missingDelete.json()).toEqual({
      _tag: "SkillManagementNotFoundError",
      id: missingID,
      message: "Skill installation not found.",
    })

    const listed = Schema.decodeUnknownSync(ManagementResponse)(
      await (await request("/api/skill/management", tmp.path)).json(),
    )
    const builtin = listed.data.find((entry) => entry.source.type === "builtin")
    expect(builtin).toBeDefined()
    const forbidden = await request(`/api/skill/management/${builtin!.id}`, tmp.path, { method: "DELETE" })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      _tag: "SkillManagementForbiddenError",
      id: builtin!.id,
      reason: "builtin",
      message: "Skill cannot be deleted.",
    })
  })

  test("serializes state write failures without exposing Skill or filesystem details", async () => {
    const contentMarker = "HTTP_SKILL_CONTENT_MUST_NOT_LEAK_7a2f"
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        const skill = path.join(directory, ".opencode", "skills", "http-operation-fixture")
        await fs.mkdir(skill, { recursive: true })
        await Bun.write(
          path.join(skill, "SKILL.md"),
          `---\nname: http-operation-fixture\ndescription: Disposable failure fixture.\n---\n${contentMarker}\n`,
        )
        return skill
      },
    })

    const listed = Schema.decodeUnknownSync(ManagementResponse)(
      await (await request("/api/skill/management", tmp.path)).json(),
    )
    const installation = listed.data.find((entry) => entry.name === "http-operation-fixture")
    expect(installation).toBeDefined()
    const stateFile = statePaths(Global.make(), listed.location).project
    await fs.mkdir(stateFile, { recursive: true })

    try {
      const failed = await request(`/api/skill/management/${installation!.id}`, tmp.path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      })
      const serialized = await failed.text()

      expect(failed.status).toBe(500)
      expect(JSON.parse(serialized)).toEqual({
        _tag: "SkillManagementOperationError",
        operation: "write",
        message: "Skill management operation failed.",
      })
      expect(serialized).not.toContain(stateFile)
      expect(serialized).not.toContain(tmp.path)
      expect(serialized).not.toContain(tmp.extra)
      expect(serialized).not.toContain(contentMarker)
      expect(serialized).not.toContain("cause")
      expect(serialized).not.toContain("PlatformError")
    } finally {
      await fs.rm(stateFile, { recursive: true, force: true })
    }
  })

  test("serializes delete failures without exposing Skill or filesystem details", async () => {
    const contentMarker = "HTTP_DELETE_CONTENT_MUST_NOT_LEAK_c862"
    const recoveryMarker = "HTTP_DELETE_RECOVERY_MUST_NOT_LEAK_ef15"
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        const skill = path.join(directory, ".opencode", "skills", "http-delete-operation-fixture")
        await fs.mkdir(skill, { recursive: true })
        await Bun.write(
          path.join(skill, "SKILL.md"),
          `---\nname: http-delete-operation-fixture\ndescription: Disposable delete failure fixture.\n---\n${contentMarker}\n`,
        )
        return skill
      },
    })

    const listed = Schema.decodeUnknownSync(ManagementResponse)(
      await (await request("/api/skill/management", tmp.path)).json(),
    )
    const installation = listed.data.find((entry) => entry.name === "http-delete-operation-fixture")
    expect(installation).toBeDefined()
    const trash = path.join(Global.Path.state, "skills", "trash")
    await fs.rm(trash, { recursive: true, force: true })
    await fs.mkdir(path.dirname(trash), { recursive: true })
    await Bun.write(trash, recoveryMarker)

    try {
      const failed = await request(`/api/skill/management/${installation!.id}`, tmp.path, { method: "DELETE" })
      const serialized = await failed.text()

      expect(failed.status).toBe(500)
      expect(JSON.parse(serialized)).toEqual({
        _tag: "SkillManagementOperationError",
        operation: "delete",
        message: "Skill management operation failed.",
      })
      expect(serialized).not.toContain(trash)
      expect(serialized).not.toContain(tmp.path)
      expect(serialized).not.toContain(tmp.extra)
      expect(serialized).not.toContain(contentMarker)
      expect(serialized).not.toContain(recoveryMarker)
      expect(serialized).not.toContain("cause")
      expect(serialized).not.toContain("PlatformError")
      expect(await fs.stat(tmp.extra)).toBeDefined()
      expect(await Bun.file(path.join(tmp.extra, "SKILL.md")).text()).toContain(contentMarker)
    } finally {
      await fs.rm(trash, { recursive: true, force: true })
    }
  })

  test("streams native EventV2 payloads across locations", async () => {
    await using subscriber = await tmpdir({ git: true })
    await using publisher = await tmpdir({ git: true })
    const response = await request("/api/event", subscriber.path)
    const reader = eventStream(response.body!)
    const connected = await readEvent(reader)
    expect(connected.type).toBe("server.connected")
    expect(connected.location).toBeUndefined()

    const created = await request("/session", publisher.path, { method: "POST" })
    expect(created.status).toBe(200)
    expect(await readEventType(reader, "session.created")).toMatchObject({
      type: "session.created",
      location: { directory: publisher.path },
      data: { sessionID: expect.any(String) },
    })
    await reader.return(undefined)
  })
})

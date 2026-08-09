import { describe, expect, test } from "bun:test"
import { createRunLocationPresentation, visibleRunLocations } from "./run-location-presentation"

describe("createRunLocationPresentation", () => {
  test("hides run-location controls for a Simple local session", () => {
    expect(createRunLocationPresentation({ mode: "simple", local: true })).toEqual({
      managementVisible: false,
      statusVisible: false,
      remoteIndicatorVisible: false,
    })
  })

  test("identifies remote execution without exposing controls in Simple mode", () => {
    expect(createRunLocationPresentation({ mode: "simple", local: false })).toEqual({
      managementVisible: false,
      statusVisible: false,
      remoteIndicatorVisible: true,
    })
  })

  test("keeps complete controls in Advanced mode", () => {
    expect(createRunLocationPresentation({ mode: "advanced", local: true })).toEqual({
      managementVisible: true,
      statusVisible: true,
      remoteIndicatorVisible: false,
    })
    expect(createRunLocationPresentation({ mode: "advanced", local: false })).toEqual({
      managementVisible: true,
      statusVisible: true,
      remoteIndicatorVisible: false,
    })
  })
})

describe("visibleRunLocations", () => {
  test("shows only the active location in Simple mode without mutating the source", () => {
    const local = { id: "local" }
    const remote = { id: "remote" }
    const list = [local, remote]

    expect(visibleRunLocations({ mode: "simple", current: remote, list })).toEqual([remote])
    expect(list).toEqual([local, remote])
  })

  test("keeps every configured location in Advanced mode", () => {
    const local = { id: "local" }
    const remote = { id: "remote" }
    const list = [local, remote]

    expect(visibleRunLocations({ mode: "advanced", current: local, list })).toBe(list)
  })

  test("returns no Simple locations when none is active", () => {
    expect(visibleRunLocations({ mode: "simple", current: undefined, list: [{ id: "remote" }] })).toEqual([])
  })
})

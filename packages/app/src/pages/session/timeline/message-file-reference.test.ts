import { describe, expect, test } from "bun:test"
import { parseMessageFileReference, resolveMessageFileReference } from "./message-file-reference"

describe("message file references", () => {
  test("parses relative, encoded, extensionless, and line-suffixed paths", () => {
    expect(parseMessageFileReference("output/report.pdf")).toEqual({ path: "output/report.pdf" })
    expect(parseMessageFileReference("./output/%E6%8A%A5%E5%91%8A%20%E6%9C%80%E7%BB%88%E7%89%88.docx")).toEqual({
      path: "./output/报告 最终版.docx",
    })
    expect(parseMessageFileReference("README")).toEqual({ path: "README" })
    expect(parseMessageFileReference("src/main.ts:128:7")).toEqual({ path: "src/main.ts", line: 128, column: 7 })
    expect(parseMessageFileReference("src/main.ts#L42C3")).toEqual({ path: "src/main.ts", line: 42, column: 3 })
  })

  test("parses POSIX, Windows, UNC, and file URL paths", () => {
    expect(parseMessageFileReference("/Users/kdtc/project/output/result.xlsx")).toEqual({
      path: "/Users/kdtc/project/output/result.xlsx",
    })
    expect(parseMessageFileReference("C:\\project\\output\\result.zip:9")).toEqual({
      path: "C:\\project\\output\\result.zip",
      line: 9,
    })
    expect(parseMessageFileReference("\\\\server\\share\\project\\artifact.bin")).toEqual({
      path: "\\\\server\\share\\project\\artifact.bin",
    })
    expect(parseMessageFileReference("file:///Users/kdtc/project/output/result.pdf")).toEqual({
      path: "/Users/kdtc/project/output/result.pdf",
    })
    expect(parseMessageFileReference("file:///C:/project/output/result.pdf")).toEqual({
      path: "C:/project/output/result.pdf",
    })
  })

  test("rejects web links, fragments, and unsupported schemes", () => {
    expect(parseMessageFileReference("https://example.com/report.pdf")).toBeUndefined()
    expect(parseMessageFileReference("http://example.com")).toBeUndefined()
    expect(parseMessageFileReference("mailto:test@example.com")).toBeUndefined()
    expect(parseMessageFileReference("data:text/plain,hello")).toBeUndefined()
    expect(parseMessageFileReference("#section")).toBeUndefined()
    expect(parseMessageFileReference("www.example.com/report")).toBeUndefined()
  })

  test("resolves relative and in-workspace POSIX paths", () => {
    expect(resolveMessageFileReference({ path: "output/report.pdf" }, "/Users/kdtc/project")).toEqual({
      relativePath: "output/report.pdf",
      absolutePath: "/Users/kdtc/project/output/report.pdf",
    })
    expect(
      resolveMessageFileReference({ path: "/Users/kdtc/project/output/report.pdf" }, "/Users/kdtc/project"),
    ).toEqual({
      relativePath: "output/report.pdf",
      absolutePath: "/Users/kdtc/project/output/report.pdf",
    })
    expect(resolveMessageFileReference({ path: "src/feature/../main.ts", line: 12 }, "/Users/kdtc/project")).toEqual({
      relativePath: "src/main.ts",
      absolutePath: "/Users/kdtc/project/src/main.ts",
      line: 12,
    })
  })

  test("resolves Windows paths case-insensitively and preserves the workspace spelling", () => {
    expect(resolveMessageFileReference({ path: "C:\\WORK\\Repo\\Output\\file.docx" }, "C:\\work\\repo")).toEqual({
      relativePath: "Output/file.docx",
      absolutePath: "C:\\work\\repo\\Output\\file.docx",
    })
    expect(
      resolveMessageFileReference(
        { path: "\\\\server\\share\\project\\folder\\file.bin" },
        "\\\\server\\share\\project",
      ),
    ).toEqual({
      relativePath: "folder/file.bin",
      absolutePath: "\\\\server\\share\\project\\folder\\file.bin",
    })
  })

  test("rejects paths outside the active workspace", () => {
    expect(resolveMessageFileReference({ path: "../secret.txt" }, "/Users/kdtc/project")).toBeUndefined()
    expect(resolveMessageFileReference({ path: "/Users/kdtc/project-old/report.pdf" }, "/Users/kdtc/project")).toBeUndefined()
    expect(resolveMessageFileReference({ path: "/etc/passwd" }, "/Users/kdtc/project")).toBeUndefined()
    expect(resolveMessageFileReference({ path: "D:\\other\\file.txt" }, "C:\\work\\repo")).toBeUndefined()
  })
})

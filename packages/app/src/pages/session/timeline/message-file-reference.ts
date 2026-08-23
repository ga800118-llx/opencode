export type MessageFileReference = {
  path: string
  line?: number
  column?: number
}

export type ResolvedMessageFileReference = {
  relativePath: string
  absolutePath: string
  line?: number
  column?: number
}

const schemePattern = /^[A-Za-z][A-Za-z\d+.-]*:/
const windowsDrivePattern = /^[A-Za-z]:[\\/]/
const windowsUncPattern = /^(?:\\\\|\/\/)/

export function parseMessageFileReference(href: string) {
  const input = href.trim()
  if (!input || input.startsWith("#") || /^www\./i.test(input)) return

  const fileURL = /^file:\/\//i.test(input)
  if (!fileURL && schemePattern.test(input) && !windowsDrivePattern.test(input)) return

  const fragment = input.match(/#L(\d+)(?:C(\d+))?$/i)
  if (input.includes("#") && !fragment) return

  const withoutFragment = fragment ? input.slice(0, fragment.index) : input
  const suffix = withoutFragment.match(/:(\d+)(?::(\d+))?$/)
  const pathValue = suffix ? withoutFragment.slice(0, suffix.index) : withoutFragment
  const path = decodePath(fileURL ? pathFromFileURL(pathValue) : pathValue)
  if (!path) return

  const line = fragment ? Number(fragment[1]) : suffix ? Number(suffix[1]) : undefined
  const column = fragment?.[2] ? Number(fragment[2]) : suffix?.[2] ? Number(suffix[2]) : undefined
  return {
    path,
    ...(line && line > 0 ? { line } : {}),
    ...(column && column > 0 ? { column } : {}),
  } satisfies MessageFileReference
}

export function resolveMessageFileReference(reference: MessageFileReference, directory: string) {
  const root = directory.replace(/[\\/]+$/, "")
  if (!root) return

  const windows = windowsDrivePattern.test(root) || windowsUncPattern.test(root)
  const rootPath = root.replace(/\\/g, "/")
  const inputPath = reference.path.replace(/\\/g, "/")
  const inputWindows = windowsDrivePattern.test(inputPath) || windowsUncPattern.test(inputPath)
  const inputPosix = inputPath.startsWith("/") && !inputWindows
  if ((windows && inputPosix) || (!windows && inputWindows)) return

  const absolute = windows ? inputWindows : inputPosix
  const relativeInput = absolute ? containedRelativePath(rootPath, inputPath, windows) : inputPath
  if (relativeInput === undefined) return

  const relativePath = normalizeRelativePath(relativeInput)
  if (!relativePath) return

  const separator = windows ? "\\" : "/"
  const absolutePath = `${root}${separator}${windows ? relativePath.replace(/\//g, "\\") : relativePath}`
  return {
    relativePath,
    absolutePath,
    ...(reference.line ? { line: reference.line } : {}),
    ...(reference.column ? { column: reference.column } : {}),
  } satisfies ResolvedMessageFileReference
}

export function messageFileReferenceFromTarget(target: EventTarget | null, directory: string) {
  if (!(target instanceof Element)) return
  const anchor = target.closest('[data-component="markdown"] a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return

  const href = anchor.getAttribute("href")
  if (!href) return
  const reference = parseMessageFileReference(href)
  if (!reference) return
  return { anchor, reference, resolved: resolveMessageFileReference(reference, directory) }
}

function pathFromFileURL(input: string) {
  try {
    const url = new URL(input)
    const path = url.host ? `//${url.host}${url.pathname}` : url.pathname
    if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1)
    return path
  } catch {
    return ""
  }
}

function decodePath(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function containedRelativePath(root: string, input: string, windows: boolean) {
  const compareRoot = windows ? root.toLowerCase() : root
  const compareInput = windows ? input.toLowerCase() : input
  if (compareInput === compareRoot) return ""
  if (!compareInput.startsWith(`${compareRoot}/`)) return
  return input.slice(root.length + 1)
}

function normalizeRelativePath(input: string) {
  const parts: string[] = []
  for (const part of input.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) return
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/") || undefined
}

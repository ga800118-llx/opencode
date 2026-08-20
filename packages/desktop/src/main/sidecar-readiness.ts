type SidecarReadinessOptions = {
  readonly directory?: string
  readonly timeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly retryDelayMs?: number
}

export async function waitForSidecarReadiness(
  url: string,
  password?: string | null,
  options: SidecarReadinessOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000
  const requestTimeoutMs = options.requestTimeoutMs ?? 3_000
  const retryDelayMs = options.retryDelayMs ?? 150
  const deadline = Date.now() + timeoutMs
  const target = new URL("/provider", url)
  if (options.directory) target.searchParams.set("directory", options.directory)
  const headers = new Headers()
  if (password) {
    headers.set("authorization", `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`)
  }

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    try {
      const response = await fetch(target, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remaining))),
      })
      const body: unknown = response.ok ? await response.json() : undefined
      if (isProviderCatalog(body)) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, Math.max(1, deadline - Date.now()))))
  }

  throw new Error("The local agent server provider catalog did not become ready.")
}

function isProviderCatalog(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false
  const all = Reflect.get(input, "all")
  const defaults = Reflect.get(input, "default")
  const connected = Reflect.get(input, "connected")
  return (
    Array.isArray(all) &&
    typeof defaults === "object" &&
    defaults !== null &&
    !Array.isArray(defaults) &&
    Array.isArray(connected)
  )
}

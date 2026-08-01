import "../../../src/index.css"
import { render } from "solid-js/web"
import { LanguageProvider } from "@/context/language"
import { type Platform, PlatformProvider } from "@/context/platform"
import {
  BROWSER_PRODUCT_RUNTIME,
  type ProductRuntime,
} from "@/product/context"
import type { ProductSidecarHost, ProductSidecarStatus } from "@/product/workflow/sidecar-status"
import { ProductRuntimeProvider } from "@/product/context"
import { SidecarRecoveryMount } from "@/components/workflow/sidecar-recovery-notice"

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const listeners = new Set<(status: ProductSidecarStatus) => void>()
let status: ProductSidecarStatus = { state: "ready", changedAt: Date.now() }
let restartPending: Deferred<ProductSidecarStatus> | undefined
let diagnosticsPending: Deferred<string> | undefined
let getStatusCalls = 0
let subscribeCalls = 0
let restartCalls = 0
let diagnosticsCalls = 0

const sidecar: ProductSidecarHost = {
  async getStatus() {
    getStatusCalls++
    return status
  },
  async subscribe(listener) {
    subscribeCalls++
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  restart() {
    restartCalls++
    restartPending = deferred<ProductSidecarStatus>()
    return restartPending.promise
  },
}

const diagnosticsAvailable = new URLSearchParams(location.search).get("diagnostics") !== "0"
const exportDebugLogs = () => {
  diagnosticsCalls++
  diagnosticsPending = deferred<string>()
  return diagnosticsPending.promise
}

const platform = {
  platform: "desktop",
  openLink() {},
  async restart() {},
  back() {},
  forward() {},
  async notify() {},
  async openDirectoryPickerDialog() {
    return null
  },
  ...(diagnosticsAvailable ? { exportDebugLogs } : {}),
} satisfies Platform

const runtime = {
  host: {
    kind: "desktop",
    modelCenter: BROWSER_PRODUCT_RUNTIME.host.modelCenter,
    sidecar,
  },
  createTaskAdapter: BROWSER_PRODUCT_RUNTIME.createTaskAdapter,
} satisfies ProductRuntime

const fixture = {
  emit(next: ProductSidecarStatus) {
    status = next
    listeners.forEach((listener) => listener(next))
  },
  resolveRestart(next: ProductSidecarStatus) {
    const pending = restartPending
    restartPending = undefined
    pending?.resolve(next)
  },
  rejectRestart() {
    const pending = restartPending
    restartPending = undefined
    pending?.reject(new Error("fixture-secret-error /Users/private/agent-service.log"))
  },
  resolveDiagnostics() {
    const pending = diagnosticsPending
    diagnosticsPending = undefined
    pending?.resolve("/Users/private/exported-agent-debug.zip")
  },
  rejectDiagnostics() {
    const pending = diagnosticsPending
    diagnosticsPending = undefined
    pending?.reject(new Error("fixture-secret-error /Users/private/agent-debug.zip"))
  },
  snapshot() {
    return { getStatusCalls, subscribeCalls, restartCalls, diagnosticsCalls }
  },
}

declare global {
  interface Window {
    sidecarRecoveryFixture: typeof fixture
  }
}

window.sidecarRecoveryFixture = fixture

render(
  () => (
    <PlatformProvider value={platform}>
      <ProductRuntimeProvider runtime={runtime}>
        <LanguageProvider locale="en">
          <div class="flex size-full min-h-0 min-w-0 flex-col">
            <SidecarRecoveryMount />
            <main
              data-testid="route-content"
              class="min-h-0 min-w-0 flex-1 bg-v2-background-bg-base p-4 text-v2-text-text-base"
            >
              Fixture route content
            </main>
          </div>
        </LanguageProvider>
      </ProductRuntimeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)

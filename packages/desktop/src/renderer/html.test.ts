import { describe, expect, test } from "bun:test"
import { join, dirname, resolve } from "node:path"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dict as english } from "./i18n/en"
import { dict as chinese } from "./i18n/zh"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../..")

const html = async (name: string) => Bun.file(join(dir, name)).text()

/**
 * Packaged Electron windows load renderer HTML via the privileged `oc://`
 * protocol. Root-relative asset paths like `src="/foo.js"` would resolve from
 * the protocol origin root instead of relative to the current HTML entrypoint.
 *
 * All local resource references must use relative paths (`./`).
 */
describe("electron renderer html", () => {
  for (const name of ["index.html"]) {
    describe(name, () => {
      test("script src attributes use relative paths", async () => {
        const content = await html(name)
        const srcs = [...content.matchAll(/\bsrc=["']([^"']+)["']/g)].map((m) => m[1])
        for (const src of srcs) {
          expect(src).not.toMatch(/^\/[^/]/)
        }
      })

      test("link href attributes use relative paths", async () => {
        const content = await html(name)
        const hrefs = [...content.matchAll(/<link[^>]+href=["']([^"']+)["']/g)].map((m) => m[1])
        for (const href of hrefs) {
          expect(href).not.toMatch(/^\/[^/]/)
        }
      })

      test("no web manifest link (not applicable in Electron)", async () => {
        const content = await html(name)
        expect(content).not.toContain('rel="manifest"')
      })

      test("uses the Agent Desktop product title", async () => {
        const content = await html(name)
        expect(content).toContain("<title>Agent Desktop</title>")
      })
    })
  }
})

test("renderer updater copy identifies Agent Desktop in English and Simplified Chinese", () => {
  expect(english["desktop.updater.none.message"]).toBe("You are already using the latest version of Agent Desktop")
  expect(english["desktop.updater.downloaded.prompt"]).toBe(
    "Version {{version}} of Agent Desktop has been downloaded, would you like to install it and relaunch?",
  )
  expect(chinese["desktop.updater.none.message"]).toBe("你已经在使用最新版本的 Agent Desktop")
  expect(chinese["desktop.updater.downloaded.prompt"]).toBe("已下载 Agent Desktop {{version}} 版本，是否安装并重启？")
})

test("window error titles use the runtime product name", async () => {
  const content = await Bun.file(join(root, "src/main/windows.ts")).text()
  expect(content).toContain("`${app.name} failed to load`")
  expect(content).toContain("`${app.name} window terminated unexpectedly`")
  expect(content).toContain("`${app.name} is not responding`")
})

/**
 * Vite resolves `publicDir` relative to `root`, not the config file.
 * This test reads the actual values from electron.vite.config.ts to catch
 * regressions where the publicDir path no longer resolves correctly
 * after the renderer root is accounted for.
 */
describe("electron vite publicDir", () => {
  test("configured publicDir resolves to a directory with oc-theme-preload.js", async () => {
    const config = await Bun.file(join(root, "electron.vite.config.ts")).text()
    const pub = config.match(/publicDir:\s*["']([^"']+)["']/)
    const rendererRoot = config.match(/root:\s*["']([^"']+)["']/)
    expect(pub).not.toBeNull()
    expect(rendererRoot).not.toBeNull()
    const resolved = resolve(root, rendererRoot![1], pub![1])
    expect(existsSync(resolved)).toBe(true)
    expect(existsSync(join(resolved, "oc-theme-preload.js"))).toBe(true)
  })
})

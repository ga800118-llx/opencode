import { $ } from "bun"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GUAI_MARK_PATH } from "@opencode-ai/ui/logo-geometry"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const faviconDirectory = path.resolve(packageDirectory, "../ui/src/assets/favicon")
const channels = ["dev", "beta", "prod"] as const
const desktopPngTargets = [
  ["32x32.png", 32],
  ["64x64.png", 64],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
  ["dock.png", 256],
  ["icon.png", 512],
] as const
const faviconPngTargets = [
  ["favicon-96x96.png", 96],
  ["favicon-96x96-v3.png", 96],
  ["apple-touch-icon.png", 180],
  ["apple-touch-icon-v3.png", 180],
  ["web-app-manifest-192x192.png", 192],
  ["web-app-manifest-512x512.png", 512],
] as const
const iconsetTargets = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
] as const

export function guaiAppIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="surface" x1="512" y1="48" x2="512" y2="976" gradientUnits="userSpaceOnUse">
      <stop stop-color="#202020" stop-opacity="0.56"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.2"/>
    </linearGradient>
  </defs>
  <rect x="48" y="48" width="928" height="928" rx="208" fill="#0D0D0D"/>
  <rect x="49" y="49" width="926" height="926" rx="207" fill="url(#surface)" stroke="#2A2A2A" stroke-width="2"/>
  <path d="${GUAI_MARK_PATH}" transform="translate(208 176) scale(6.08)" fill="#FFFFFF"/>
</svg>
`
}

export function encodeIco(images: readonly { size: number; data: Uint8Array }[]) {
  const directorySize = 6 + images.length * 16
  const output = new Uint8Array(directorySize + images.reduce((total, image) => total + image.data.length, 0))
  const view = new DataView(output.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  images.reduce((offset, image, index) => {
    const entry = 6 + index * 16
    view.setUint8(entry, image.size === 256 ? 0 : image.size)
    view.setUint8(entry + 1, image.size === 256 ? 0 : image.size)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, image.data.length, true)
    view.setUint32(entry + 12, offset, true)
    output.set(image.data, offset)
    return offset + image.data.length
  }, directorySize)
  return output
}

async function generateBrandIcons() {
  if (process.platform !== "darwin") throw new Error("Brand icon generation currently requires macOS sips and iconutil")
  const temporary = await mkdtemp(path.join(tmpdir(), "guai-brand-icons-"))
  try {
    const svg = path.join(temporary, "guai-app-icon.svg")
    const source = path.join(temporary, "guai-app-icon.png")
    await Bun.write(svg, guaiAppIconSvg())
    await $`sips -s format png ${svg} --out ${source}`.quiet()

    const sizes = new Map<number, Promise<string>>([[1024, Promise.resolve(source)]])
    const png = (size: number) => {
      const existing = sizes.get(size)
      if (existing) return existing
      const rendering = (async () => {
        const target = path.join(temporary, `guai-app-icon-${size}.png`)
        await $`sips -z ${size} ${size} ${source} --out ${target}`.quiet()
        return target
      })()
      sizes.set(size, rendering)
      return rendering
    }
    const writePng = async (target: string, size: number) => {
      await mkdir(path.dirname(target), { recursive: true })
      await Bun.write(target, Bun.file(await png(size)))
    }

    const iconset = path.join(temporary, "Guai.iconset")
    await mkdir(iconset)
    await Promise.all(
      iconsetTargets.map(async ([name, size]) => Bun.write(path.join(iconset, name), Bun.file(await png(size)))),
    )
    const icns = path.join(temporary, "icon.icns")
    await $`iconutil -c icns ${iconset} -o ${icns}`.quiet()

    const ico = encodeIco(
      await Promise.all(
        [16, 32, 48, 64, 128, 256].map(async (size) => ({
          size,
          data: new Uint8Array(await Bun.file(await png(size)).arrayBuffer()),
        })),
      ),
    )

    await Promise.all(
      channels.flatMap((channel) => {
        const directory = path.join(packageDirectory, "icons", channel)
        return [
          ...desktopPngTargets.map(([name, size]) => writePng(path.join(directory, name), size)),
          Bun.write(path.join(directory, "icon.icns"), Bun.file(icns)),
          Bun.write(path.join(directory, "icon.ico"), ico),
        ]
      }),
    )

    await Promise.all([
      ...faviconPngTargets.map(([name, size]) => writePng(path.join(faviconDirectory, name), size)),
      Bun.write(path.join(faviconDirectory, "favicon.svg"), guaiAppIconSvg()),
      Bun.write(path.join(faviconDirectory, "favicon-v3.svg"), guaiAppIconSvg()),
    ])
    const faviconIco = encodeIco(
      await Promise.all(
        [16, 32, 48, 96].map(async (size) => ({
          size,
          data: new Uint8Array(await Bun.file(await png(size)).arrayBuffer()),
        })),
      ),
    )
    await Promise.all([
      Bun.write(path.join(faviconDirectory, "favicon.ico"), faviconIco),
      Bun.write(path.join(faviconDirectory, "favicon-v3.ico"), faviconIco),
    ])
    console.log("Generated Guai desktop and favicon assets")
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (import.meta.main) await generateBrandIcons()

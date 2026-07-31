import { describe, expect, test } from "bun:test"
import type { FilePartSource } from "@opencode-ai/sdk/v2/client"
import type { ProductFileSource } from "./contracts"

const roundTrip = (source: ProductFileSource) => {
  const transport: FilePartSource = source
  const product: ProductFileSource = transport
  return product
}

describe("ProductFileSource", () => {
  test.each([
    {
      name: "file",
      source: {
        type: "file",
        path: "/repo/src/index.ts",
        text: { value: "@src/index.ts", start: 4, end: 17 },
      },
    },
    {
      name: "symbol",
      source: {
        type: "symbol",
        path: "/repo/src/index.ts",
        text: { value: "@createApp", start: 18, end: 28 },
        range: {
          start: { line: 10, character: 2 },
          end: { line: 18, character: 3 },
        },
        name: "createApp",
        kind: 12,
      },
    },
    {
      name: "resource",
      source: {
        type: "resource",
        text: { value: "@design", start: 29, end: 36 },
        clientName: "design-mcp",
        uri: "mcp://design/resource/1",
      },
    },
  ] satisfies readonly { name: string; source: ProductFileSource }[])(
    "round-trips $name source fields through the public transport type",
    ({ source }) => {
      expect(roundTrip(source)).toEqual(source)
    },
  )
})

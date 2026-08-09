import type { ProductPresentationMode } from "./presentation"

export function createRunLocationPresentation(input: { mode: ProductPresentationMode; local: boolean }) {
  const advanced = input.mode === "advanced"
  return {
    managementVisible: advanced,
    statusVisible: advanced,
    remoteIndicatorVisible: !advanced && !input.local,
  } as const
}

export function visibleRunLocations<T>(input: { mode: ProductPresentationMode; current: T | undefined; list: T[] }) {
  if (input.mode === "advanced") return input.list
  return input.current ? [input.current] : []
}

export function synchronizeApplicationLocale(
  locale: string,
  update: () => Promise<void> | void,
  warn: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
) {
  return Promise.resolve()
    .then(update)
    .catch((error) => {
      warn(`Failed to synchronize native application locale "${locale}".`, error)
    })
}

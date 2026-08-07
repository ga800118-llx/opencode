import { APPLICATION_LOCALE_CHANNEL } from "../application-locale"

export { APPLICATION_LOCALE_CHANNEL } from "../application-locale"

export function createApplicationLocaleSetter(invoke: (channel: string, locale: string) => Promise<unknown>) {
  return (locale: string) => invoke(APPLICATION_LOCALE_CHANNEL, locale).then(() => undefined)
}

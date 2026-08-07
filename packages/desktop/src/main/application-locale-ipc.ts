import { APPLICATION_LOCALE_CHANNEL } from "../application-locale"

export function registerApplicationLocaleIpc(
  register: (channel: string, listener: (locale: string) => Promise<void> | void) => void,
  setApplicationLocale: (locale: string) => Promise<void> | void,
) {
  register(APPLICATION_LOCALE_CHANNEL, setApplicationLocale)
}

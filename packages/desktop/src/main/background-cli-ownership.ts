type OwnedBackgroundCli = {
  readonly stop: () => Promise<void>
}

export function createBackgroundCliOwnership<T extends OwnedBackgroundCli>() {
  let rawStartup: Promise<T> | undefined
  let startup: Promise<T> | undefined
  let controller: T | undefined
  let controllerStop: Promise<void> | undefined
  let stopPromise: Promise<boolean> | undefined
  let stopRequested = false

  const stopController = (value: T) => {
    if (controllerStop) return controllerStop
    controllerStop = Promise.resolve().then(() => value.stop())
    return controllerStop
  }

  return {
    start(start: () => Promise<T>) {
      if (stopRequested) return Promise.reject(new Error("V2 sidecar startup cannot begin after shutdown"))
      if (startup) return startup
      rawStartup = Promise.resolve().then(start)
      startup = rawStartup.then(async (value) => {
        if (!stopRequested) {
          controller = value
          return value
        }
        await stopController(value)
        throw new Error("V2 sidecar startup completed after shutdown began")
      })
      return startup
    },
    current() {
      return controller
    },
    hasStartup() {
      return rawStartup !== undefined
    },
    stop() {
      stopRequested = true
      if (stopPromise) return stopPromise
      stopPromise = (async () => {
        const value = await rawStartup?.catch(() => undefined)
        if (!value) return false
        await stopController(value).finally(() => {
          controller = undefined
        })
        return true
      })()
      return stopPromise
    },
  }
}

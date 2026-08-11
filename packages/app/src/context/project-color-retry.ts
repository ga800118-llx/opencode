type RetryState = {
  retries: number
  allowed: boolean
  timer?: unknown
}

export function createProjectColorRetryController(input: {
  retry: (worktree: string) => void
  schedule?: (run: () => void, delay: number) => unknown
  cancel?: (timer: unknown) => void
  delays?: readonly number[]
}) {
  const states = new Map<string, RetryState>()
  const delays = input.delays ?? [1_000, 2_000]
  const schedule = input.schedule ?? ((run: () => void, delay: number) => setTimeout(run, delay))
  const cancel = input.cancel ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  function clear(worktree: string) {
    const state = states.get(worktree)
    if (state?.timer !== undefined) cancel(state.timer)
    states.delete(worktree)
  }

  function failed(worktree: string) {
    const current = states.get(worktree) ?? { retries: 0, allowed: true }
    if (current.timer !== undefined) return false
    if (current.retries >= delays.length) {
      states.set(worktree, { retries: current.retries, allowed: false })
      return false
    }

    const state: RetryState = { retries: current.retries + 1, allowed: false }
    state.timer = schedule(() => {
      if (states.get(worktree) !== state) return
      state.timer = undefined
      state.allowed = true
      input.retry(worktree)
    }, delays[current.retries]!)
    states.set(worktree, state)
    return true
  }

  function dispose() {
    for (const worktree of states.keys()) clear(worktree)
  }

  return {
    failed,
    clear,
    has: (worktree: string) => states.has(worktree),
    canAttempt: (worktree: string) => states.get(worktree)?.allowed ?? true,
    dispose,
  }
}

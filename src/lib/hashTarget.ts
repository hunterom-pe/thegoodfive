/**
 * Pages here load their content late (lazy route chunks, then the edition from the database), so a
 * link such as /about#method or /#story-3 opened in a fresh tab points at something that does not
 * exist yet. `whenAvailable` waits for it, instead of trying once and giving up.
 */
export interface Waiter<T> {
  /** The element, or null while it doesn't exist yet. */
  find: () => T | null
  /** Call back whenever the page changes. Returns an unsubscribe function. */
  subscribe: (onChange: () => void) => () => void
  /** Give up after this long. */
  timeoutMs: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

/** Resolves with the element as soon as it exists; resolves null after the timeout or when cancelled. */
export function whenAvailable<T>(w: Waiter<T>): { result: Promise<T | null>; cancel: () => void } {
  const setTimer = w.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = w.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
  let settle: (value: T | null) => void = () => {}
  const result = new Promise<T | null>((resolve) => (settle = resolve))
  const first = w.find()
  if (first) {
    settle(first)
    return { result, cancel: () => {} }
  }
  let finished = false
  let unsubscribe = () => {}
  let timer: unknown
  const finish = (value: T | null) => {
    if (finished) return
    finished = true
    unsubscribe()
    clearTimer(timer)
    settle(value)
  }
  unsubscribe = w.subscribe(() => {
    const el = w.find()
    if (el) finish(el)
  })
  timer = setTimer(() => finish(null), w.timeoutMs)
  return { result, cancel: () => finish(null) }
}

/**
 * The element id a URL fragment points at, or null when there is none or it cannot be read.
 * "#%" or "#%E0%A4" are not valid percent-encoding: decoding them throws, which must never take the
 * page down. Such a fragment simply points nowhere.
 */
export function hashToId(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

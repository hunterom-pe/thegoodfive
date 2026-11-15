/**
 * Small, defensive wrapper around the browser's localStorage, for reader preferences that live only on this
 * device: saved stories, reading progress, the story a reader took with them. No network, no accounts.
 *
 * Storage can be missing (private browsing, blocked cookies, server rendering), full, or hold anything at
 * all (an old version, another script, a hand edit). Every read is validated by the caller's parser and
 * every failure falls back to an in-memory copy, so the page keeps working: the reader simply loses the
 * memory when they close the tab, and the interface says so.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LocalStore<T> {
  get(): T
  set(value: T): void
  /** True when values persist across visits; false when only this tab remembers them. */
  persistent(): boolean
  subscribe(listener: () => void): () => void
}

/** The real localStorage, or null if the browser refuses it. Touching it can throw, so it is probed. */
export function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const probe = '__goodfive_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * A typed value kept under one key. `parse` receives whatever JSON was stored (or undefined) and must return a
 * valid value, discarding anything it does not recognise; invalid data is never thrown back at the page.
 */
export function createLocalStore<T>(key: string, parse: (raw: unknown) => T, storage: KeyValueStorage | null = browserStorage()): LocalStore<T> {
  let memory: T | undefined
  const empty = parse(undefined) // one stable empty value, so React never sees a 'new' value on every read
  let usable = storage !== null
  let cached: { raw: string | null; value: T } | undefined
  const listeners = new Set<() => void>()

  const read = (): T => {
    if (!usable || !storage) return memory ?? empty
    try {
      const raw = storage.getItem(key)
      if (cached && cached.raw === raw) return cached.value // stable identity for React
      let decoded: unknown
      try {
        decoded = raw === null ? undefined : JSON.parse(raw)
      } catch {
        decoded = undefined // corrupt JSON: start again
      }
      const value = parse(decoded)
      cached = { raw, value }
      return value
    } catch {
      usable = false
      return memory ?? empty
    }
  }

  const notify = () => listeners.forEach((l) => l())

  if (typeof window !== 'undefined' && storage) {
    // Another tab changed it: tell this one.
    window.addEventListener?.('storage', (e: StorageEvent) => {
      if (e.key === key) notify()
    })
  }

  return {
    get: read,
    set(value) {
      memory = value
      if (usable && storage) {
        try {
          const raw = JSON.stringify(value)
          storage.setItem(key, raw)
          cached = { raw, value }
        } catch {
          usable = false // full or blocked: keep it in memory for this visit
        }
      }
      notify()
    },
    persistent: () => usable,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/** A plain object, or null. */
export const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
export const isISODateString = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

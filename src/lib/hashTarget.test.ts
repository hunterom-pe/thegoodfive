import { describe, expect, it, vi } from 'vitest'
import { hashToId, whenAvailable } from './hashTarget'

describe('waiting for a #hash target that loads late', () => {
  it('resolves at once when the target already exists', async () => {
    const { result } = whenAvailable({ find: () => 'el', subscribe: () => () => {}, timeoutMs: 1000 })
    expect(await result).toBe('el')
  })
  it('waits for a lazily mounted section, then resolves exactly once and stops listening', async () => {
    let dom: string | null = null
    let notify = () => {}
    const unsubscribe = vi.fn()
    const { result } = whenAvailable({ find: () => dom, subscribe: (cb) => ((notify = cb), unsubscribe), timeoutMs: 1000 })
    notify() // page changed, target still missing (e.g. the spinner swapped for the page shell)
    dom = 'method-section'
    notify()
    expect(await result).toBe('method-section')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
  it('gives up with null after the timeout (for example, an edition that does not exist)', async () => {
    let fire = () => {}
    const { result } = whenAvailable({ find: () => null, subscribe: () => () => {}, timeoutMs: 5000, setTimer: (fn) => ((fire = fn), 1), clearTimer: () => {} })
    fire()
    expect(await result).toBeNull()
  })
  it('can be cancelled, as when a reader starts scrolling', async () => {
    const { result, cancel } = whenAvailable({ find: () => null, subscribe: () => () => {}, timeoutMs: 5000 })
    cancel()
    expect(await result).toBeNull()
  })
})

describe('reading a URL fragment safely', () => {
  it('decodes valid fragments, including encoded and non-ASCII ids', () => {
    expect(hashToId('#method')).toBe('method')
    expect(hashToId('#story-3')).toBe('story-3')
    expect(hashToId('#caf%C3%A9')).toBe('café')
    expect(hashToId('#a%20b')).toBe('a b')
  })
  it('returns null for an empty or malformed fragment instead of throwing', () => {
    for (const bad of ['#%', '#%E0%A4', '#%E0%A4%A', '#%ZZ', '#abc%', '#%C3']) expect(hashToId(bad), bad).toBeNull()
    expect(hashToId('')).toBeNull()
    expect(hashToId('#')).toBeNull()
  })
})

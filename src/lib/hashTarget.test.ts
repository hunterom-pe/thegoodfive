import { describe, expect, it, vi } from 'vitest'
import { whenAvailable } from './hashTarget'

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

import { useCallback, useEffect, useState } from 'react'

export type Async<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

/** Load once per key, with a retry handle. Late responses for an old key are dropped. */
export function useAsync<T>(load: () => Promise<T>, key: string): [Async<T>, () => void] {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    load().then(
      (data) => live && setState({ status: 'ready', data }),
      (e: unknown) => live && setState({ status: 'error', error: e instanceof Error ? e.message : 'Something went wrong.' }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  return [state, useCallback(() => setAttempt((n) => n + 1), [])]
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} — The Good Five` : 'The Good Five — Five good things. Every day.'
  }, [title])
}

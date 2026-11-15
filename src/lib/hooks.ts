import { useCallback, useEffect, useState } from 'react'
import type { PageMeta } from './meta'

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

const setTag = (selector: string, create: () => HTMLElement, attr: string, value: string) => {
  const el = document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(create())
  el.setAttribute(attr, value)
}
const meta = (key: 'name' | 'property', name: string) => () => {
  const el = document.createElement('meta')
  el.setAttribute(key, name)
  return el
}

/**
 * Keep the page's tags right while the reader navigates. The server writes the same values into the HTML
 * for crawlers (netlify/edge-functions/page-meta.ts); this covers moving between pages without a reload.
 */
export function usePageMeta(m: PageMeta) {
  useEffect(() => {
    document.title = m.title
    setTag('meta[name="description"]', meta('name', 'description'), 'content', m.description)
    setTag('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', m.canonical)
    setTag('meta[property="og:url"]', meta('property', 'og:url'), 'content', m.canonical)
    setTag('meta[property="og:title"]', meta('property', 'og:title'), 'content', m.shareTitle)
    setTag('meta[property="og:description"]', meta('property', 'og:description'), 'content', m.description)
    setTag('meta[name="twitter:title"]', meta('name', 'twitter:title'), 'content', m.shareTitle)
    setTag('meta[name="twitter:description"]', meta('name', 'twitter:description'), 'content', m.description)
    const robots = document.head.querySelector('meta[name="robots"]')
    if (m.noindex) setTag('meta[name="robots"]', meta('name', 'robots'), 'content', 'noindex, follow')
    else robots?.remove()
  }, [m.title, m.description, m.canonical, m.shareTitle, m.noindex])
}

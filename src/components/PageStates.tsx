import type { ReactNode } from 'react'
import { FiveSquares, wrap } from './Brand'

export function PageMessage({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`${wrap} flex min-h-[60dvh] flex-col justify-center py-16`}>
      <FiveSquares />
      <h1 className="display mt-7 max-w-[12em] text-[2.25rem] sm:text-5xl">{title}</h1>
      {children && <div className="mt-4 max-w-[26rem] text-[1rem] leading-relaxed text-ink/75">{children}</div>}
      {action && <div className="mt-7">{action}</div>}
    </section>
  )
}

export function PageLoading({ label = 'Gathering the five…' }: { label?: string }) {
  return (
    <section className={`${wrap} flex min-h-[calc(100dvh-3.5rem)] flex-col justify-center`} role="status">
      <FiveSquares className="motion-safe:animate-pulse" />
      <p className="label mt-5 text-earth">{label}</p>
    </section>
  )
}

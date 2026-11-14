import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { BrandMark, wrap } from './Brand'

const navLink = ({ isActive }: { isActive: boolean }) =>
  `label flex h-11 items-center transition-colors hover:text-forest ${isActive ? 'text-forest' : 'text-ink/70'}`

export function SiteHeader({ progress }: { progress?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-chalk">
      <div className={`${wrap} flex h-14 items-center justify-between gap-2 sm:gap-4`}>
        <Link to="/" className="flex h-11 shrink-0 items-center gap-2 sm:gap-2.5" aria-label="The Good Five — today’s edition">
          <BrandMark />
          <span className="whitespace-nowrap font-display text-[1.1875rem] font-[480] tracking-[-0.02em] text-forest">The Good Five</span>
        </Link>
        <div className="flex items-center gap-2.5 sm:gap-7">
          {progress}
          <nav aria-label="Site" className="flex items-center gap-4 sm:gap-7">
            <NavLink to="/archive" className={navLink}>
              Archive
            </NavLink>
            <NavLink to="/about" className={(s) => `${navLink(s)} max-sm:hidden`}>
              About
            </NavLink>
          </nav>
        </div>
      </div>
    </header>
  )
}

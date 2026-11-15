import { Link } from 'react-router-dom'
import { BrandMark, wrap } from './Brand'

const link = 'flex min-h-11 items-center text-[0.9375rem] text-ink/75 link-quiet hover:text-forest'

export function SiteFooter() {
  return (
    <footer className="bg-chalk">
      <div className={`${wrap} pb-10 pt-12 lg:pt-16`}>
        <div className="lg:grid lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <Link to="/" className="inline-flex items-center gap-2.5">
              <BrandMark />
              <span className="font-display text-[1.1875rem] font-[480] tracking-[-0.02em] text-forest">The Good Five</span>
            </Link>
            <p className="mt-4 max-w-[22rem] text-[0.9375rem] leading-relaxed text-ink/75">
              Five good things. Every day. That’s it. A small independent edition of genuinely good news, found and written up with AI, checked automatically, and open to human correction.
            </p>
          </div>
          <nav aria-label="Footer" className="mt-7 grid grid-cols-2 gap-x-6 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Link to="/archive" className={link}>
              Archive
            </Link>
            <Link to="/about" className={link}>
              About
            </Link>
            <Link to="/saved" className={link}>
              Saved stories
            </Link>
            <Link to="/about#method" className={link}>
              How we choose
            </Link>
            <Link to="/about#sources" className={link}>
              Sources &amp; credit
            </Link>
          </nav>
        </div>
        <p className="mt-10 border-t border-line pt-5 text-[0.75rem] leading-relaxed text-ink/70">
          © {new Date().getFullYear()} The Good Five. Summaries are our own; every story links to the original reporting, and all rights in those articles and images remain with their publishers.
        </p>
      </div>
    </footer>
  )
}

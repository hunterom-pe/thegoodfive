import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FiveSquares, wrap } from '../components/Brand'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { IS_DEMO } from '../lib/config'
import { useTitle } from '../lib/hooks'

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-line py-10 lg:grid lg:grid-cols-12 lg:gap-12 lg:py-14">
      <div className="lg:col-span-5">
        <p className="label tabular-nums text-earth">{n}</p>
        <h2 className="display mt-2 text-[2rem] lg:text-[2.75rem]">{title}</h2>
      </div>
      <div className="mt-5 space-y-4 text-[1.0625rem] leading-[1.62] text-ink lg:col-span-6 lg:col-start-7 lg:mt-1 [&_a]:font-semibold [&_a]:text-forest">{children}</div>
    </section>
  )
}

const KINDS = [
  'People helping people, and ordinary acts of decency',
  'Medical advances and better health',
  'Science and discovery',
  'Nature, wildlife and environmental recovery',
  'Slow, meaningful progress that rarely makes a headline',
]

export function AboutPage() {
  useTitle('About')
  return (
    <>
      <SiteHeader />
      <main className={wrap}>
        <section className="pb-12 pt-8 sm:pt-12 lg:pb-20 lg:pt-20">
          <p className="label flex items-center gap-2.5 text-forest">
            <span className="size-2 bg-forest" aria-hidden="true" />
            About
          </p>
          <h1 className="display mt-5 max-w-[10em] text-[2.875rem] sm:text-[4rem] lg:text-[5.75rem]">Five good things. Every day. That’s it.</h1>
          <p className="display display-wonk mt-4 max-w-[18em] text-[1.5rem] !leading-[1.18] !text-earth lg:text-[2.25rem]">
            A small daily reminder that the world is also full of people quietly making it better.
          </p>
        </section>

        <Section id="mission" n="01" title="Why this exists">
          <p>
            The hard news is real, and we’re not pretending otherwise. But it isn’t the whole picture. Every day rivers are cleaned, diseases are beaten back, and strangers look after one another, and most of it goes unreported or scrolls past unnoticed.
          </p>
          <p>The Good Five is a place to notice it. One edition a day, five stories, a few minutes of your time. No accounts, no comments, and no feed that never ends. When you reach the end, you’re done.</p>
          <ul className="!mt-6 space-y-2.5">
            {KINDS.map((kind) => (
              <li key={kind} className="flex gap-3 text-[1rem] leading-snug">
                <span className="mt-[0.4em] size-2 shrink-0 bg-sage" aria-hidden="true" />
                {kind}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="method" n="02" title="How it works">
          <p>
            Every morning, software searches a global news index and a list of credible outlets. It sets aside duplicates, and an AI model picks stories that look genuinely positive, significant, recent and well sourced. It then writes a short summary of each, using only what the original report says.
          </p>
          <p>
            Automated checks come next: the source must be real and recent, and every name, number and claim in a summary has to be traceable to the article it cites. If everything passes, the edition publishes by itself. If anything fails, the edition is held back and nothing goes out that day, rather than something we can’t stand behind.
          </p>
          <p>
            Those checks are good, not perfect. They show a summary matches its source, not that the source is right, and AI can still make mistakes. An editor can review, change or pull any edition at any time, and when we get something wrong we correct it and say so.
          </p>
          <p>We’d rather run a modest story that’s true than an exciting one that isn’t. If a day’s best five are all about science, so be it; we don’t force a quota.</p>
        </Section>

        <Section id="sources" n="03" title="Sources & credit">
          <p>
            We summarise; we don’t republish. Every story names the outlet that reported it, shows when it was published, and links straight to the original. The reporting is theirs, and we’d encourage you to read it in full.
          </p>
          <p>
            Photographs appear only when we’re confident we have the right to show them, and are credited when they do. Automatic editions usually use a composition of squares instead, because the licensed photo services we use ask for a person to choose each picture. An editor can add a photo afterwards. A news site’s preview image is not an invitation to reuse it.
          </p>
          <p>If we get something wrong, we correct the story and say so.</p>
        </Section>

        {IS_DEMO && (
          <Section id="demo" n="04" title="About the sample stories">
            <p>
              You’re looking at a demonstration build. It isn’t connected to a live newsroom yet, so the editions on this site are <strong>invented sample content</strong>: the places, publications, people and figures are fictional, written to show how real editions will look and read.
            </p>
            <p>They are not real reporting and shouldn’t be quoted as such. That’s also why their source links lead here rather than to an article. Sample photographs are from Unsplash.</p>
          </Section>
        )}

        <section className="border-t border-line py-12 lg:py-16">
          <FiveSquares size={12} gap={6} />
          <p className="display mt-6 text-[1.75rem] lg:text-[2.5rem]">
            <Link to="/" className="underline decoration-sage decoration-1 underline-offset-[0.16em] hover:decoration-forest">
              Read today’s five.
            </Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

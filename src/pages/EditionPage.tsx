import { Link, useParams } from 'react-router-dom'
import { EditionView } from '../components/EditionView'
import { PageLoading, PageMessage } from '../components/PageStates'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { StoryProgress } from '../components/StoryProgress'
import { StoryStrip } from '../components/ReaderTools'
import { publicRepo } from '../data/publicRepo'
import { isISODate, todayISO } from '../lib/dates'
import { useAsync, usePageMeta } from '../lib/hooks'
import { metaForPath } from '../lib/meta'

export function EditionPage() {
  const { date = '' } = useParams()
  const valid = isISODate(date)
  const [state, retry] = useAsync(() => (valid ? publicRepo.byDate(date) : Promise.resolve(null)), `edition:${date}`)
  const edition = state.status === 'ready' ? state.data : null
  usePageMeta(metaForPath(`/edition/${date}`, valid ? { date, headlines: edition?.stories.map((s) => s.headline), exists: state.status === 'ready' ? Boolean(edition) : undefined } : null))

  const back = (
    <Link to="/archive" className="btn">
      Browse the archive
    </Link>
  )
  return (
    <>
      <SiteHeader progress={edition ? <StoryProgress count={edition.stories.length} /> : null} strip={edition ? <StoryStrip stories={edition.stories} /> : null} />
      <main>
        {!valid && (
          <PageMessage title="That isn’t an edition date." action={back}>
            Editions have addresses like /edition/2026-11-13. Try the archive to find the one you want.
          </PageMessage>
        )}
        {valid && state.status === 'loading' && <PageLoading label="Opening the archive…" />}
        {valid && state.status === 'error' && (
          <PageMessage
            title="We couldn’t open that edition."
            action={
              <button type="button" className="btn btn-solid" onClick={retry}>
                Try again
              </button>
            }
          />
        )}
        {valid &&
          state.status === 'ready' &&
          (edition ? (
            <EditionView edition={edition} context={edition.date === todayISO() ? 'today' : 'archive'} />
          ) : date === todayISO() ? (
            <PageMessage
              title="Today’s edition isn’t ready yet."
              action={
                <Link to="/" className="btn btn-solid">
                  Read the latest edition
                </Link>
              }
            >
              It’s still being checked before it’s published. Until then, the most recent edition is on the front page.
            </PageMessage>
          ) : date > todayISO() ? (
            <PageMessage title="That edition hasn’t been published yet." action={back}>
              Editions appear on the morning of their date.
            </PageMessage>
          ) : (
            <PageMessage title="There’s no edition for that date." action={back}>
              Either we didn’t publish that day, or the date isn’t quite right.
            </PageMessage>
          ))}
      </main>
      <SiteFooter />
    </>
  )
}

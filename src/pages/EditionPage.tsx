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
        {state.status === 'loading' && <PageLoading label="Opening the archive…" />}
        {state.status === 'error' && (
          <PageMessage
            title="We couldn’t open that edition."
            action={
              <button type="button" className="btn btn-solid" onClick={retry}>
                Try again
              </button>
            }
          />
        )}
        {state.status === 'ready' &&
          (edition ? (
            <EditionView edition={edition} context={edition.date === todayISO() ? 'today' : 'archive'} />
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

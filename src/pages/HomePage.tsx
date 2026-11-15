import { EditionView } from '../components/EditionView'
import { PageLoading, PageMessage } from '../components/PageStates'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { StoryProgress } from '../components/StoryProgress'
import { StoryStrip } from '../components/ReaderTools'
import { publicRepo } from '../data/publicRepo'
import { todayISO } from '../lib/dates'
import { useAsync, usePageMeta } from '../lib/hooks'
import { metaForPath } from '../lib/meta'

export function HomePage() {
  usePageMeta(metaForPath('/'))
  const [state, retry] = useAsync(() => publicRepo.latest(), 'latest')
  const edition = state.status === 'ready' ? state.data : null
  return (
    <>
      <SiteHeader progress={edition ? <StoryProgress count={edition.stories.length} /> : null} strip={edition ? <StoryStrip stories={edition.stories} /> : null} />
      <main>
        {state.status === 'loading' && <PageLoading />}
        {state.status === 'error' && (
          <PageMessage
            title="We couldn’t load today’s edition."
            action={
              <button type="button" className="btn btn-solid" onClick={retry}>
                Try again
              </button>
            }
          >
            The good news is still out there. This is just a connection problem on our side.
          </PageMessage>
        )}
        {state.status === 'ready' &&
          (edition ? (
            // "Today" is only claimed when the edition is really dated today.
            <EditionView edition={edition} context={edition.date === todayISO() ? 'today' : 'latest'} />
          ) : (
            <PageMessage title="The first edition is on its way.">Five good things, every day, starting soon.</PageMessage>
          ))}
      </main>
      <SiteFooter />
    </>
  )
}

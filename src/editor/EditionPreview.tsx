import { Link, useParams } from 'react-router-dom'
import { EditionView } from '../components/EditionView'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { StoryProgress } from '../components/StoryProgress'
import { editionAsPublic } from '../data/publicRepo'
import { todayISO } from '../lib/dates'
import { useAsync, useTitle } from '../lib/hooks'
import { editorRepo } from './editorRepo'

/** The edition exactly as readers will get it, built from the same components. */
export function EditionPreview() {
  const { id = '' } = useParams()
  useTitle('Preview')
  const [state] = useAsync(() => editorRepo.get(id), `preview:${id}`)
  const edition = state.status === 'ready' && state.data ? editionAsPublic(state.data) : null
  const status = state.status === 'ready' ? state.data?.status : undefined

  return (
    <>
      <div className="bg-earth text-chalk">
        <div className="mx-auto flex max-w-[72rem] items-center justify-between gap-4 px-5 py-1 sm:px-8 lg:px-12">
          <p className="label">Preview · {status === 'published' ? 'published' : 'not published'}</p>
          <Link to={`/editor/${id}`} className="label flex min-h-11 items-center underline underline-offset-4">
            Back to editing
          </Link>
        </div>
      </div>
      <SiteHeader progress={edition ? <StoryProgress count={edition.stories.length} /> : null} />
      <main>
        {state.status === 'loading' && <p className="label p-8 text-earth">Building preview…</p>}
        {state.status === 'error' && <p className="p-8 text-earth">{state.error}</p>}
        {state.status === 'ready' && !edition && <p className="p-8">That edition doesn’t exist.</p>}
        {edition && <EditionView edition={edition} context={edition.date < todayISO() ? 'archive' : 'today'} />}
      </main>
      <SiteFooter />
    </>
  )
}

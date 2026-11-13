import { Link } from 'react-router-dom'
import { PageMessage } from '../components/PageStates'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { useTitle } from '../lib/hooks'

export function NotFoundPage() {
  useTitle('Page not found')
  return (
    <>
      <SiteHeader />
      <main>
        <PageMessage
          title="This page isn’t one of the five."
          action={
            <Link to="/" className="btn btn-solid">
              Read today’s edition
            </Link>
          }
        >
          The link may be old, or the address slightly off.
        </PageMessage>
      </main>
      <SiteFooter />
    </>
  )
}

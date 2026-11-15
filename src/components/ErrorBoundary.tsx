import { Component, type ReactNode } from 'react'
import { PageMessage } from './PageStates'

/**
 * A last line of defence: if anything in a page throws while rendering, show a way back instead of a
 * blank screen. Plain links (not router links), so recovery works even if routing state is the problem.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('page error:', error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <PageMessage
        title="Something went wrong on this page."
        action={
          <a href="/" className="btn btn-solid">
            Go to today’s five
          </a>
        }
      >
        The good news is still there. Reloading usually fixes this.
      </PageMessage>
    )
  }
}

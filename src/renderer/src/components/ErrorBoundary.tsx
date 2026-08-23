import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps one broken component from taking the window with it.
 *
 * React's default on an uncaught render error is to unmount the whole tree,
 * which shows as the app appearing for an instant and then vanishing - no
 * message, nothing in the window to act on, and the cause only visible to
 * someone who knows to open the developer console. A chat client that cannot
 * draw its channel list should still be a window you can read an error from
 * and reload.
 *
 * This is a genuine last resort rather than routine error handling: anything
 * that can be anticipated belongs where it happens.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is what makes this actionable; the message alone
    // rarely says which part of the tree failed.
    console.error('[moho] render failed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="render-error">
        <h2>Something in the interface stopped working</h2>
        <p className="muted">
          The rest of the app was closed to avoid showing you a half-drawn window. Reloading
          usually clears it; if it happens every time, this is a bug worth reporting.
        </p>
        <pre className="render-error-detail">{error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

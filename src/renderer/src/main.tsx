import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Popout } from './Popout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { store } from './state/store'
import './theme.css'
import './app.css'

/**
 * Every window runs this file. Which one it is was decided when it was
 * created: main tells a popped-out window, through its preload, the one
 * conversation it exists to show.
 */
const popoutBufferId = window.moho.popout.bufferId

// Forward uncaught renderer errors and unhandled promise rejections into the
// console with the `[moho]` prefix so main writes them into `moho.log`.
window.addEventListener('error', (event) => {
  const err = event.error instanceof Error ? event.error : null
  const loc = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ''
  const detail = err?.stack || `${event.message || 'Unknown error'}${loc}`
  console.error(`[moho] uncaught error: ${detail}`)
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const detail =
    reason instanceof Error ? reason.stack || `${reason.name}: ${reason.message}` : String(reason)
  console.error(`[moho] unhandled rejection: ${detail}`)
})

// The screenshot harness's way in (scripts/ui-shots.mjs). Present only in a
// window main started with MOHO_UI_SHOTS=1, never in a normal launch.
if (window.moho.uiShots) {
  ;(window as unknown as { __mohoShots: unknown }).__mohoShots = {
    patch: (patch: Parameters<typeof store.shotsPatch>[0]) => store.shotsPatch(patch),
    state: () => store.getSnapshot(),
    store
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {popoutBufferId ? <Popout bufferId={popoutBufferId} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)

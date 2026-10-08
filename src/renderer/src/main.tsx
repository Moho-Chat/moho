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

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Popout } from './Popout'
import { ErrorBoundary } from './components/ErrorBoundary'
import './theme.css'
import './app.css'

/**
 * Every window runs this file. Which one it is was decided when it was
 * created: main tells a popped-out window, through its preload, the one
 * conversation it exists to show.
 */
const popoutBufferId = window.moho.popout.bufferId

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {popoutBufferId ? <Popout bufferId={popoutBufferId} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)

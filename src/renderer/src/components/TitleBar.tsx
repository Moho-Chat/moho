import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat } from '../state/hooks'

/**
 * The window's own chrome, drawn in the renderer because the BrowserWindow is
 * frameless - same 44px bar with icon, title and window controls the original
 * floating window had.
 *
 * A popped-out conversation is named by that conversation rather than by the
 * app: several of these can be on screen at once, and a row of windows all
 * called "moho" is a row you have to click through to tell apart - in the
 * taskbar as much as on the desktop.
 */
export function TitleBar({ title }: { title?: string } = {}): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const linkUp = useChat((s) => s.linkUp)

  useEffect(() => {
    void window.moho.window.isMaximized().then(setMaximized)
    return window.moho.onMaximizeChange(setMaximized)
  }, [])

  return (
    <div className="titlebar">
      {/* Fills the bar so it can be dragged from anywhere. The controls sit
          within its rectangle and take themselves back out with no-drag - a
          drag region is resolved by the compositor before the page sees the
          press, so DOM order and stacking do not exempt anything from it. */}
      <div className="titlebar-drag" />

      <div className="titlebar-brand">
        <Icon name="chat" size={20} color="var(--primary)" />
        <span className="titlebar-title ellipsis" title={title}>
          {title ?? 'moho'}
        </span>
        {!linkUp && (
          <span className="titlebar-status" title="Not connected to the nobilis daemon">
            <Icon name="cloud_off" size={14} />
            disconnected
          </span>
        )}
      </div>

      <div className="titlebar-controls">
        <IconButton name="remove" title="Minimize" onClick={() => void window.moho.window.minimize()} />
        <IconButton
          name={maximized ? 'fullscreen_exit' : 'fullscreen'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.moho.window.toggleMaximize().then(setMaximized)}
        />
        <IconButton name="close" title="Close" onClick={() => void window.moho.window.close()} />
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat } from '../state/hooks'

/**
 * The window's own chrome, drawn in the renderer because the BrowserWindow is
 * frameless - same 44px bar with icon, title and window controls the original
 * floating window had.
 */
export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const linkUp = useChat((s) => s.linkUp)

  useEffect(() => {
    void window.moho.window.isMaximized().then(setMaximized)
    return window.moho.onMaximizeChange(setMaximized)
  }, [])

  return (
    <div className="titlebar">
      {/* The drag region has to be a sibling of the buttons, not their parent:
          -webkit-app-region: drag swallows clicks on anything inside it. */}
      <div className="titlebar-drag" />

      <div className="titlebar-brand">
        <Icon name="chat" size={20} color="var(--primary)" />
        <span className="titlebar-title">moho</span>
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

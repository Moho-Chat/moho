import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { BufferList } from './components/BufferList'
import { MessageList } from './components/MessageList'
import { Composer } from './components/Composer'
import { NickList } from './components/NickList'
import { AccountsPanel } from './components/AccountsPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { JoinPanel } from './components/JoinPanel'
import { Toasts } from './components/Toasts'
import { Icon, IconButton } from './components/Icon'
import { useActiveBuffer, useChat, usePref, usePrefsReady, useStore } from './state/hooks'
import { bufferDisplayName } from './lib/util'

export default function App(): JSX.Element {
  const store = useStore()
  const prefsReady = usePrefsReady()
  const [booted, setBooted] = useState(false)

  const accounts = useChat((s) => s.accounts)
  const activePanel = useChat((s) => s.activePanel)
  const activeBufferId = useChat((s) => s.activeBufferId)
  const joinPanelAccountId = useChat((s) => s.joinPanelAccountId)
  const buffer = useActiveBuffer()
  const joinAccount = accounts.find((a) => a.id === joinPanelAccountId)

  const [sidebarFolded, setSidebarFolded] = usePref<boolean>('ui.sidebarFolded', false)
  const [userListFolded, setUserListFolded] = usePref<boolean>('ui.userListFolded', false)
  const [savedBufferId] = usePref<string>('ui.activeBufferId', '')

  // Boot once prefs have loaded, so the restored buffer selection is available
  // before the store asks chatd for its backlog.
  useEffect(() => {
    if (!prefsReady || booted) return
    setBooted(true)
    void store.init(savedBufferId)
    return () => store.dispose()
  }, [prefsReady, booted, savedBufferId, store])

  // A stale restored id is harmless: it simply resolves to no buffer and the
  // empty state shows, exactly as it would for "".
  const showNickList =
    !userListFolded && activePanel === '' && buffer?.kind === 'channel'

  const headerTitle =
    activePanel === 'accounts'
      ? 'Accounts'
      : activePanel === 'settings'
        ? 'Settings'
        : activePanel === 'join'
        ? `Join · ${joinAccount?.displayName ?? ''}`
        : buffer
            ? bufferDisplayName(buffer.name)
            : ''

  return (
    <div className="app">
      <TitleBar />

      <div className="app-body">
        {!sidebarFolded && (
          <>
            <div className="sidebar">
              <BufferList />
            </div>
            <div className="divider-v" />
          </>
        )}

        <div className="main-column">
          <div className="main-header">
            <IconButton
              name={sidebarFolded ? 'chevron_right' : 'chevron_left'}
              title={sidebarFolded ? 'Show sidebar' : 'Hide sidebar'}
              onClick={() => setSidebarFolded(!sidebarFolded)}
            />
            <span className="main-header-title ellipsis">{headerTitle}</span>

            {activePanel === '' && buffer?.kind === 'channel' && (
              <IconButton
                name={userListFolded ? 'group' : 'group_off'}
                title={userListFolded ? 'Show members' : 'Hide members'}
                onClick={() => setUserListFolded(!userListFolded)}
              />
            )}
            {activePanel !== '' && (
              <IconButton
                name="close"
                title="Back to chat"
                onClick={() => store.setActivePanel('')}
              />
            )}
          </div>

          <div className="main-body">
            <Body activePanel={activePanel} hasAccounts={accounts.length > 0} hasBuffer={!!activeBufferId} />
          </div>

          {activePanel === '' && activeBufferId !== '' && <Composer />}
        </div>

        {showNickList && (
          <>
            <div className="divider-v" />
            <div className="nicklist-pane">
              <NickList />
            </div>
          </>
        )}
      </div>

      <Toasts />
    </div>
  )
}

function Body({
  activePanel,
  hasAccounts,
  hasBuffer
}: {
  activePanel: string
  hasAccounts: boolean
  hasBuffer: boolean
}): JSX.Element {
  if (activePanel === 'settings') return <SettingsPanel />
  // With no accounts at all, the accounts panel is the only useful thing to
  // show - there is nothing to chat in yet.
  if (activePanel === 'accounts' || !hasAccounts) return <AccountsPanel />
  if (activePanel === 'join') return <JoinPanel />
  if (hasBuffer) return <MessageList />
  return <Placeholder icon="forum" text="Select or join a channel" />
}

function Placeholder({ icon, text }: { icon: string; text: string }): JSX.Element {
  return (
    <div className="placeholder muted">
      <Icon name={icon} size={32} />
      <span>{text}</span>
    </div>
  )
}

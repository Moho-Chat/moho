import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { BufferList } from './components/BufferList'
import { ServerRail } from './components/ServerRail'
import { MessageList } from './components/MessageList'
import { MentionsPage } from './components/MentionsPage'
import { MENTIONS_GROUP_ID } from './lib/groups'
import { Composer } from './components/Composer'
import { NickList } from './components/NickList'
import { ConversationTools } from './components/ConversationTools'
import { AccountsPanel } from './components/AccountsPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { JoinPanel } from './components/JoinPanel'
import { Toasts } from './components/Toasts'
import { IncomingCallPanel } from './components/IncomingCallPanel'
import { Icon, IconButton } from './components/Icon'
import { Avatar } from './components/Avatar'
import { dmStatus } from './components/BufferList'
import { useActiveBuffer, useChat, usePref, usePrefsReady, useStore } from './state/hooks'
import { bufferDisplayName } from './lib/util'
import type { BufferEntry } from './state/store'

export default function App(): JSX.Element {
  const store = useStore()
  const prefsReady = usePrefsReady()
  const [booted, setBooted] = useState(false)

  const accounts = useChat((s) => s.accounts)
  const activePanel = useChat((s) => s.activePanel)
  const activeBufferId = useChat((s) => s.activeBufferId)
  const activeGroupId = useChat((s) => s.activeGroupId)
  const joinPanelAccountId = useChat((s) => s.joinPanelAccountId)
  const buffer = useActiveBuffer()
  const joinAccount = accounts.find((a) => a.id === joinPanelAccountId)

  const [sidebarFolded, setSidebarFolded] = usePref<boolean>('ui.sidebarFolded', false)
  const [userListFolded, setUserListFolded] = usePref<boolean>('ui.userListFolded', false)
  const [savedBufferId] = usePref<string>('ui.activeBufferId', '')
  const [savedGroupId] = usePref<string>('ui.activeGroupId', '')

  // Boot once prefs have loaded, so the restored buffer selection is available
  // before the store asks nobilis for its backlog.
  useEffect(() => {
    if (!prefsReady || booted) return
    setBooted(true)
    void store.init(savedBufferId, savedGroupId)
    return () => store.dispose()
  }, [prefsReady, booted, savedBufferId, savedGroupId, store])

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
        : activeGroupId === MENTIONS_GROUP_ID
          ? 'Mentions'
          : buffer
            ? bufferDisplayName(buffer.name)
            : ''

  return (
    <div className="app">
      <TitleBar />

      <div className="app-body">
        {!sidebarFolded && (
          <>
            {/* The rail folds away with the channel list: they are one
                navigation surface, and leaving a strip of server icons beside
                a collapsed sidebar would be a column that selects something
                you cannot see. */}
            <ServerRail />
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
            {/* A conversation is headed by whoever it is with, the same way
                its row in the list is - the picture and the status together,
                not a bare name. */}
            {activePanel === '' && buffer && <BufferFace buffer={buffer} />}
            <span className="main-header-title ellipsis">{headerTitle}</span>

            {activePanel === '' && buffer && <ConversationTools buffer={buffer} />}

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
            <Body
              activePanel={activePanel}
              hasAccounts={accounts.length > 0}
              hasBuffer={!!activeBufferId}
              activeGroupId={activeGroupId}
            />
          </div>

          {activePanel === '' && activeBufferId !== '' && activeGroupId !== MENTIONS_GROUP_ID && (
            <Composer />
          )}
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

      {/* Over everything: a call arrives while you are looking elsewhere. */}
      <IncomingCallPanel />
      <Toasts />
    </div>
  )
}

/**
 * The face at the head of a conversation: their picture, and how they are.
 *
 * Shown only where there is one person to show. A channel's header has no
 * single face, and inventing one - the first member, the last to speak -
 * would be worse than none.
 */
function BufferFace({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const presence = useChat((s) => s.presenceByBuffer)
  const buffers = useChat((s) => s.buffers)
  if (buffer.kind !== 'dm') return null

  return (
    <span className="header-face">
      <Avatar name={buffer.name} url={buffer.avatarUrl} size={24} status={dmStatus(buffer, presence, buffers)} />
    </span>
  )
}

function Body({
  activePanel,
  hasAccounts,
  hasBuffer,
  activeGroupId
}: {
  activePanel: string
  hasAccounts: boolean
  hasBuffer: boolean
  activeGroupId: string
}): JSX.Element {
  if (activePanel === 'settings') return <SettingsPanel />
  // With no accounts at all, the accounts panel is the only useful thing to
  // show - there is nothing to chat in yet.
  if (activePanel === 'accounts' || !hasAccounts) return <AccountsPanel />
  if (activePanel === 'join') return <JoinPanel />
  // The mentions page replaces the log rather than sitting beside it: it is a
  // list of places to go, and every row leads into a conversation.
  if (activeGroupId === MENTIONS_GROUP_ID) return <MentionsPage />
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

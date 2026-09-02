import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { BufferList } from './components/BufferList'
import { ServerRail } from './components/ServerRail'
import { MessageList } from './components/MessageList'
import { MentionsInbox } from './components/MentionsInbox'
import { MentionsPage } from './components/MentionsPage'
import { MENTIONS_GROUP_ID } from './lib/groups'
import { Composer } from './components/Composer'
import { MembershipGate } from './components/MembershipGate'
import { NickList } from './components/NickList'
import { ThreadPanel } from './components/ThreadPanel'
import { ConversationTools } from './components/ConversationTools'
import { AccountsPanel } from './components/AccountsPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { DownloadsPanel } from './components/DownloadsPanel'
import { JoinPanel } from './components/JoinPanel'
import { Toasts } from './components/Toasts'
import { IncomingCallPanel } from './components/IncomingCallPanel'
import { FileDrop } from './components/FileDrop'
import { TransferPanel } from './components/TransferPanel'
import { Icon, IconButton } from './components/Icon'
import { BufferFace } from './components/BufferFace'
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

  /**
   * The mentions page is showing, so nothing in the window is scoped to one
   * conversation - the header face, the conversation's own tools and the
   * composer all belong to a buffer that is not on screen.
   */
  const onMentionsPage = activePanel === '' && activeGroupId === MENTIONS_GROUP_ID

  const openThread = useChat((s) => s.openThread)

  // A stale restored id is harmless: it simply resolves to no buffer and the
  // empty state shows, exactly as it would for "".
  const showNickList =
    !userListFolded && activePanel === '' && !onMentionsPage && buffer?.kind === 'channel'

  const headerTitle =
    activePanel === 'accounts'
      ? 'Accounts'
      : activePanel === 'settings'
        ? 'Settings'
        : activePanel === 'downloads'
        ? 'Downloads'
        : activePanel === 'join'
        ? `Join · ${joinAccount?.displayName ?? ''}`
        : onMentionsPage
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
            {activePanel === '' && !onMentionsPage && buffer && <BufferFace buffer={buffer} />}
            <span className="main-header-title ellipsis">{headerTitle}</span>

            {/* The face, the search and the call button all act on the open
                conversation, which the mentions page is not showing - leaving
                them there would offer to search a channel that isn't on
                screen. */}
            {activePanel === '' && !onMentionsPage && buffer && (
              <ConversationTools buffer={buffer} />
            )}

            {/* The inbox is about everywhere rather than about this
                conversation, so it sits outside the conversation's own tools -
                but beside them, because the header is where the things you
                glance at live. Shown on every page for the same reason: a
                mention does not stop mattering because you are reading a
                direct message. */}
            {activePanel === '' && <MentionsInbox />}

            {activePanel === '' && !onMentionsPage && buffer?.kind === 'channel' && (
              <IconButton
                name={userListFolded ? 'group' : 'group_off'}
                title={userListFolded ? 'Show members' : 'Hide members'}
                onClick={() => setUserListFolded(!userListFolded)}
              />
            )}

            {/* Beside the member list toggle rather than among the
                conversation's own tools: both of these are about how this
                conversation is being shown, not about the conversation. Last,
                because it is the one that opens something. */}
            {activePanel === '' && !onMentionsPage && buffer && <PopOutButton buffer={buffer} />}
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
            <>
              {/* Above the box, saying why it will not work here yet. */}
              {buffer && <MembershipGate buffer={buffer} />}
              <Composer />
            </>
          )}
        </div>

        {/* A thread stands where the member list would, and closes it while
            it is open: both are a column beside the conversation, and two of
            them at once leaves the conversation itself too narrow to read. */}
        {openThread && (
          <>
            <div className="divider-v" />
            <ThreadPanel />
          </>
        )}

        {!openThread && showNickList && (
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
      {/* Over everything for the same reason: a file is offered while you are
          reading something else, and often in a conversation you are not. */}
      <TransferPanel />
      <FileDrop />
      <Toasts />
    </div>
  )
}

/**
 * Sends this conversation to a window of its own, or raises the one it has.
 *
 * One window per conversation: two views of the same channel would each mark
 * it read and each have an opinion about where its window belongs, so asking
 * again for one that is already out brings it forward instead.
 */
function PopOutButton({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const popouts = useChat((s) => s.popouts)
  const out = popouts.open.includes(buffer.id)
  return (
    <IconButton
      name="open_in_new"
      title={out ? 'Show this conversation’s window' : 'Watch this in a window of its own'}
      className={out ? 'active' : undefined}
      onClick={() => store.popOut(buffer.id)}
    />
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
  // Above the no-accounts case below: a finished download is still worth
  // looking at on a machine whose accounts have since been removed.
  if (activePanel === 'downloads') return <DownloadsPanel />
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

import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { MessageList } from './components/MessageList'
import { Composer } from './components/Composer'
import { MembershipGate } from './components/MembershipGate'
import { NickList } from './components/NickList'
import { ConversationTools } from './components/ConversationTools'
import { BufferFace } from './components/BufferFace'
import { FileDrop } from './components/FileDrop'
import { Toasts } from './components/Toasts'
import { CallStage, IncomingMatrixCall, ScreenPicker } from './components/CallStage'
import { StreamStage } from './components/StreamStage'
import { Icon, IconButton } from './components/Icon'
import { useActiveBuffer, useChat, usePref, usePrefsReady, useStore } from './state/hooks'
import { bufferDisplayName } from './lib/util'

/**
 * One conversation, in a window of its own.
 *
 * Built to watch several channels at once, which is the one thing a single
 * window cannot do however it is arranged: a sidebar shows you where traffic
 * is, but only ever one conversation's worth of it.
 *
 * Deliberately not a second implementation of the chat view. The log, the
 * composer, the member list and dropping a file all read whichever buffer the
 * store has open, so a popout is that same store with the open buffer nailed
 * down - see the store's pinTo. Everything below is the frame around them:
 * what a window needs that a pane does not, and nothing that would be a second
 * copy of behaviour the main window already owns.
 *
 * What is left out is as deliberate. There is no rail, no conversation list
 * and no settings, because a window that could navigate anywhere is just
 * another main window; and the offer prompts that float over everything -
 * incoming calls, file transfers - stay in the main window alone, since the
 * same question asked in four windows at once is four chances to answer it
 * differently.
 */
export function Popout({ bufferId }: { bufferId: string }): JSX.Element {
  const store = useStore()
  const prefsReady = usePrefsReady()
  const [booted, setBooted] = useState(false)
  const buffer = useActiveBuffer()
  const linkUp = useChat((s) => s.linkUp)
  const activeCall = useChat((s) => s.activeCall)
  const watching = useChat((s) => s.watching)
  // Folded by default: a popout is a narrow window opened to read one
  // conversation, and a member list would take a third of it before anything
  // has been read.
  const [membersFolded, setMembersFolded] = usePref<boolean>('ui.popoutMembersFolded', true)

  useEffect(() => {
    if (!prefsReady || booted) return
    setBooted(true)
    // Pinned before the store starts, so nothing that arrives during startup -
    // a restored selection, a notification already queued - can land this
    // window on a different conversation than the one it was opened for.
    store.pinTo(bufferId)
    void store.init(bufferId)
    return () => store.dispose()
  }, [prefsReady, booted, bufferId, store])

  const name = buffer ? bufferDisplayName(buffer.name) : ''

  // The window's own name follows the conversation, so several of these are
  // told apart in a taskbar without being raised one at a time.
  useEffect(() => {
    if (name) document.title = name
  }, [name])

  const showMembers = !membersFolded && buffer?.kind === 'channel'

  return (
    <div className="app popout">
      <TitleBar title={name || 'moho'} />

      <div className="app-body">
        <div className="main-column">
          <div className="main-header">
            {buffer && <BufferFace buffer={buffer} />}
            <span className="main-header-title ellipsis">{name}</span>

            {buffer && <ConversationTools buffer={buffer} />}

            {buffer?.kind === 'channel' && (
              <IconButton
                name={membersFolded ? 'group' : 'group_off'}
                title={membersFolded ? 'Show members' : 'Hide members'}
                onClick={() => setMembersFolded(!membersFolded)}
              />
            )}
            {/* The way back. Closing this window leaves the conversation
                wherever it was; this puts it in front of you in the main
                window, which is what "I am done watching this separately"
                actually means. */}
            <IconButton
              name="dock_to_right"
              title="Put this back in the main window"
              onClick={() => store.dock(bufferId, true)}
            />
          </div>

          <div className="main-body">
            {buffer ? (
              <MessageList />
            ) : (
              <div className="placeholder muted">
                <Icon name={linkUp ? 'search_off' : 'cloud_off'} size={32} />
                {/* Two genuinely different situations, and the difference is
                    what somebody needs to know: one resolves itself, and the
                    other means this window is showing a conversation that no
                    longer exists. */}
                <span>{linkUp ? 'This conversation is no longer open' : 'Connecting…'}</span>
              </div>
            )}
          </div>

          {buffer && (
            <>
              <MembershipGate buffer={buffer} />
              <Composer />
            </>
          )}
        </div>

        {showMembers && (
          <>
            <div className="divider-v" />
            <div className="nicklist-pane">
              <NickList />
            </div>
          </>
        )}
      </div>

      <FileDrop />
      {/* A call rings wherever the client is, including here: this window has
          its own connection to the daemon and its own media, so a call
          answered here is answered here. */}
      <IncomingMatrixCall />
      <ScreenPicker />
      {/* A popped-out conversation is one conversation, so a call that is not
          this one is in the corner and this one is above the log. */}
      {activeCall && activeCall.bufferId !== bufferId && <CallStage mode="pip" />}
      {watching && watching.bufferId !== bufferId && <StreamStage mode="pip" />}
      <Toasts />
    </div>
  )
}

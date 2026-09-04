import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { AddToConversation } from './AddToConversation'
import { useChat, useStore } from '../state/hooks'
import { classes, formatFullTime } from '../lib/util'
import type { BufferEntry } from '../state/store'
import type { Message } from '../../../shared/wire'

/**
 * Asking somebody into a Matrix room.
 *
 * A field rather than a picker, because a Matrix address names a person
 * globally - there is no roster to choose from and nobody to look up first.
 * Offered on every Matrix room rather than gated on permission: the server
 * decides, and it says so plainly enough that guessing here would only mean
 * hiding the action from somebody who could have used it.
 */
function InviteToRoom({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)

  const invite = (): void => {
    const userId = who.trim()
    if (!userId) return
    setBusy(true)
    void window.moho
      .rpc('inviteMatrixMember', { accountId: buffer.accountId, bufferId: buffer.id, userId })
      .then(() => {
        store.toast('info', `Invited ${userId}`)
        setWho('')
        setOpen(false)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  if (!open) {
    return <IconButton name="person_add" title="Invite somebody to this room" onClick={() => setOpen(true)} />
  }

  return (
    <div className="conversation-search">
      <Icon name="person_add" size={16} />
      <input
        autoFocus
        type="text"
        value={who}
        placeholder="@someone:server"
        disabled={busy}
        onChange={(e) => setWho(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setWho('')
            setOpen(false)
          }
          if (e.key === 'Enter') invite()
        }}
        onBlur={() => !who.trim() && setOpen(false)}
      />
    </div>
  )
}

/**
 * What a channel's restrictions mean, for the ones worth explaining.
 *
 * IRC writes them as letters because that is what its server says; Kick has
 * no such spelling and words them instead, so anything already in words is
 * passed through rather than read a letter at a time - "followers only" is
 * not f, o, l, l, o, w.
 *
 * The letter table is not complete and is not trying to be: every network
 * invents its own, and these are the handful that change whether you can say
 * anything. An unknown letter is shown as itself.
 */
function describeModes(modes: string): string {
  if (/[\s]/.test(modes) || !/^\+?[a-z]+$/i.test(modes)) return modes
  const meanings: Record<string, string> = {
    m: 'moderated — only voiced users may speak',
    i: 'invite only',
    t: 'topic locked to operators',
    n: 'no messages from outside the channel',
    s: 'secret — hidden from the channel list',
    k: 'needs a key',
    l: 'has a user limit',
    r: 'registered users only'
  }
  const described = [...modes.replace(/[^a-z]/gi, '')].map((letter) => meanings[letter] ?? letter)
  return described.length ? described.join(', ') : modes
}

/**
 * The call button and search box at the head of a conversation.
 *
 * Both belong to the conversation rather than to the window, which is why they
 * live in the header beside its name instead of in a global toolbar: what they
 * act on is whatever is being read.
 */
export function ConversationTools({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const store = useStore()
  const sessions = useChat((s) => s.voiceSessions)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[] | null>(null)
  const [searching, setSearching] = useState(false)
  /** Loading backwards towards a search result, which can take a moment. */
  const [jumping, setJumping] = useState(false)
  const [calling, setCalling] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const isDiscord = buffer.accountId.startsWith('discord:')
  const stream = useChat((s) => s.kickStreams)[buffer.id]
  const isDm = buffer.kind === 'dm'
  // This conversation's call, not merely a call on the same account: one
  // account can only be in one, but the button has to be right about which.
  const inCall = sessions.some((s) => s.bufferId === buffer.id)

  // Searching on every keystroke would query the database for every prefix of
  // a word on the way to typing it; a short pause after typing stops is both
  // cheaper and what the results are actually wanted for.
  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setResults(null)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      void window.moho
        .rpc<Message[]>('searchMessages', { bufferId: buffer.id, query: text, limit: 50 })
        .then(setResults)
        .catch((e: Error) => {
          store.toast('error', `Couldn't search: ${e.message}`)
          setResults([])
        })
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, buffer.id, store])

  // Clicking anywhere else puts the results away, the way any other transient
  // panel behaves.
  useEffect(() => {
    if (!results) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setResults(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [results])

  const rerun = async (): Promise<void> => {
    setSearching(true)
    try {
      setResults(await window.moho.rpc<Message[]>('searchMessages', { bufferId: buffer.id, query: query.trim(), limit: 50 }))
    } catch (e) {
      store.toast('error', `Couldn't search: ${(e as Error).message}`)
    } finally {
      setSearching(false)
    }
  }

  const jumpTo = async (id: string): Promise<void> => {
    const loaded = !!document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`)
    if (!loaded) {
      // Search reads the whole stored conversation while the view holds only
      // the newest part of it. Load backwards until the message is there.
      setJumping(true)
      try {
        if (!(await store.jumpToMessage(buffer.id, id))) {
          store.toast('info', "Couldn't reach that message - it is a long way back")
          return
        }
      } finally {
        setJumping(false)
      }
    }
    // The log does the scrolling. It pins itself to the bottom while you are
    // reading there, and newly loaded rows keep growing as their pictures
    // arrive - so a scroll from out here is undone a moment later by the very
    // mechanism that keeps the tail in view.
    store.setJumpTarget(id)
    setResults(null)
  }

  const call = (): void => {
    if (inCall) {
      void store.leaveVoice(buffer.accountId)
      return
    }
    setCalling(true)
    void store.callBuffer(buffer.id).finally(() => setCalling(false))
  }

  return (
    <div className="conversation-tools" ref={box}>
      {/* What the channel itself is set to. Only where there is something to
          say - an unmodded channel has no modes worth a badge - and titled
          with the long form, since the letters are only obvious to people who
          already knew. */}
      {buffer.channelModes && (
        <span className="channel-modes small" title={describeModes(buffer.channelModes)}>
          {buffer.channelModes}
        </span>
      )}

      {/* What the stream is, for a channel that is one. Kick's chat is
          watched beside a video this client does not show, so the title, the
          game and the number of people watching are the context the chat is
          missing - and "offline" is worth saying too, since a quiet channel
          and an off-air one look identical otherwise. */}
      {/* Following is the one thing about a Kick channel somebody changes from
          here - subscribing is money and raiding is the broadcaster's own
          gesture, and neither belongs behind a button in a chat client.
          Absent for an account that cannot say, rather than offering to do
          something that would fail. */}
      {stream && stream.following !== null && stream.following !== undefined && (
        <button
          type="button"
          className={classes('button', 'subtle', 'follow-button', stream.following && 'following')}
          title={stream.following ? 'Stop following this channel' : 'Follow this channel'}
          onClick={() => store.setFollowing(buffer.id, !stream.following)}
        >
          <Icon name={stream.following ? 'favorite' : 'favorite_border'} size={15} />
          {stream.following ? 'Following' : 'Follow'}
        </button>
      )}

      {stream && (
        <span
          className={classes('stream-chip', 'small', stream.live && 'live')}
          title={
            stream.live
              ? [stream.title, stream.category, stream.viewers ? `${stream.viewers.toLocaleString()} watching` : null]
                  .filter(Boolean)
                  .join(' · ')
              : 'Not streaming right now'
          }
        >
          {stream.live ? (
            <>
              <span className="stream-dot" />
              <span className="ellipsis">{stream.title || 'Live'}</span>
              {stream.category && <span className="muted ellipsis">{stream.category}</span>}
              {stream.viewers !== null && stream.viewers !== undefined && (
                <span className="muted">{stream.viewers.toLocaleString()}</span>
              )}
            </>
          ) : (
            <span className="muted">offline</span>
          )}
        </span>
      )}
      {isDiscord && isDm && (
        <IconButton
          name={inCall ? 'call_end' : 'call'}
          title={inCall ? 'Hang up' : `Call ${buffer.name}`}
          className={inCall ? 'calling' : undefined}
          disabled={calling}
          onClick={call}
        />
      )}

      {/* Beside the call button, for the same reason it is here: it acts on
          the conversation being read rather than on the window. */}
      {isDiscord && isDm && <AddToConversation buffer={buffer} />}

      {/* The same job on Matrix, where it needs no picker: a Matrix address
          names somebody whether or not this account has ever met them, so
          there is no friend list to choose from and nothing to look up. */}
      {buffer.accountId.startsWith('matrix:') && <InviteToRoom buffer={buffer} />}

      <div className="conversation-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={query}
          placeholder={`Search ${buffer.name}`}
          onChange={(e) => setQuery(e.target.value)}
          // Jumping to a result puts the panel away. Coming back to a box
          // that still holds a query should show what it found rather than
          // requiring the text to be changed before it will answer again.
          onFocus={() => query.trim() && !results && void rerun()}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), setResults(null))}
        />
      </div>

      {results && (
        <div className="search-results">
          <div className="search-results-head small muted">
            {searching
              ? 'Searching…'
              : jumping
                ? 'Loading older messages…'
                : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
          </div>
          {results.map((m) => (
            <button key={m.id} type="button" className="search-result" onClick={() => void jumpTo(m.id)}>
              <span className="search-result-head small">
                <span className="search-result-from">{m.from}</span>
                <span className="muted">{formatFullTime(m.ts)}</span>
              </span>
              <span className="search-result-body small ellipsis">{m.body}</span>
            </button>
          ))}
          {!searching && results.length === 0 && (
            <div className="search-results-empty small muted">Nothing found in this conversation.</div>
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { formatFullTime } from '../lib/util'
import type { BufferEntry } from '../state/store'
import type { Message } from '../../../shared/wire'

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
      {isDiscord && isDm && (
        <IconButton
          name={inCall ? 'call_end' : 'call'}
          title={inCall ? 'Hang up' : `Call ${buffer.name}`}
          className={inCall ? 'calling' : undefined}
          disabled={calling}
          onClick={call}
        />
      )}

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

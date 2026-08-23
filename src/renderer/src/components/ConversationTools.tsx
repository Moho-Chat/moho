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
  const [calling, setCalling] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const isDiscord = buffer.accountId.startsWith('discord:')
  const isDm = buffer.kind === 'dm'
  // A call in this conversation, as opposed to one somewhere else entirely.
  const inCall = sessions.some((s) => s.accountId === buffer.accountId && s.isDirect)

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

  const jumpTo = (id: string): void => {
    const row = document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`)
    if (!row) {
      // Search covers the whole stored conversation while the window holds
      // only part of it, so saying where it is beats scrolling to nothing.
      store.toast('info', 'That message is further back than the loaded history')
      return
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.add('found')
    setTimeout(() => row.classList.remove('found'), 2000)
    setResults(null)
  }

  const call = (): void => {
    if (inCall) {
      void store.leaveVoice(buffer.accountId)
      return
    }
    setCalling(true)
    void window.moho
      .rpc('startDiscordCall', { bufferId: buffer.id })
      .then(() => store.refreshVoiceSessions())
      .catch((e: Error) => store.toast('error', `Couldn't call: ${e.message}`))
      .finally(() => setCalling(false))
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
              : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
          </div>
          {results.map((m) => (
            <button key={m.id} type="button" className="search-result" onClick={() => jumpTo(m.id)}>
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

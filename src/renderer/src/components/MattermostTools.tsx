import { useRef, useState } from 'react'
import { IconButton } from './Icon'
import { HeaderPopover } from './HeaderPopover'
import { useChat, useStore } from '../state/hooks'
import { classes, formatFullTime } from '../lib/util'
import type { BufferEntry } from '../state/store'
import type { Message } from '../../../shared/wire'

/**
 * What a Mattermost account keeps beside its channels, from a conversation's header: the threads it follows (with
 * what is unread in them), the posts it saved, this channel's bookmarks, the posts it has scheduled, and its drafts on
 * the server. Each list is asked for when its tab is opened; a row goes to what it names.
 */
type Tab = 'threads' | 'saved' | 'bookmarks' | 'scheduled' | 'drafts'

interface ThreadRow {
  id: string
  bufferId: string
  replies: number
  unreadReplies: number
  unreadMentions: number
  lastReply?: number
  root?: Message
}

interface Bookmark {
  id: string
  name: string
  url?: string
  emoji?: string
  kind: string
}

interface Scheduled {
  id: string
  bufferId?: string
  text: string
  at?: number
  error?: string
}

interface Draft {
  bufferId: string
  rootId?: string
  text: string
  updated?: number
}

/** A post's first line, as plain words for a row: its Markdown marks and table rules taken out. */
function firstLine(body: string | undefined): string {
  const line = (body ?? '').split('\n').find((l) => l.trim() !== '') ?? ''
  return line.replace(/\*\*|__|~~|`/g, '').replace(/\[mattermost:emoji:([^:\]]+):[^\]]*\]/g, ':$1:').trim()
}

const LABELS: Record<Tab, string> = { threads: 'Threads', saved: 'Saved', bookmarks: 'Bookmarks', scheduled: 'Scheduled', drafts: 'Drafts' }

export function MattermostTools({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const store = useStore()
  const server = useChat((s) => s.mattermostServers[buffer.accountId])
  const buffers = useChat((s) => s.buffers)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('threads')
  const [rows, setRows] = useState<unknown[] | null>(null)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [when, setWhen] = useState('')
  const [text, setText] = useState('')
  const anchor = useRef<HTMLSpanElement>(null)
  const team = server?.teams?.[0]?.id ?? ''
  const teamOf = (): string => {
    const group = buffer.groupId ?? ''
    const own = group.includes('|team:') ? group.split('|team:')[1] : ''
    return own || team
  }
  const call = <T,>(action: string, params: Record<string, unknown> = {}): Promise<T> =>
    window.moho.rpc<T>('mattermost', { action, accountId: buffer.accountId, bufferId: buffer.id, teamId: teamOf(), ...params })

  const load = (which: Tab): void => {
    setTab(which)
    setRows(null)
    const done = (list: unknown[]): void => setRows(list)
    const failed = (e: Error): void => {
      store.toast('error', e.message)
      setRows([])
    }
    if (which === 'threads') void call<{ threads: ThreadRow[] }>('threads').then((a) => done(a.threads)).catch(failed)
    if (which === 'saved') void call<{ posts: Message[] }>('saved').then((a) => done(a.posts)).catch(failed)
    if (which === 'bookmarks') void call<{ bookmarks: Bookmark[] }>('bookmarks').then((a) => done(a.bookmarks)).catch(failed)
    if (which === 'scheduled') void call<{ scheduled: Scheduled[] }>('scheduled').then((a) => done(a.scheduled)).catch(failed)
    if (which === 'drafts') void call<{ drafts: Draft[] }>('drafts').then((a) => done(a.drafts)).catch(failed)
  }

  const go = (bufferId: string, messageId?: string, thread?: string): void => {
    setOpen(false)
    void store.selectBuffer(bufferId).then(() => {
      if (thread) void store.openThreadPanel(bufferId, thread)
      else if (messageId)
        void store.jumpToMessage(bufferId, messageId).then((there) => {
          if (there) store.setJumpTarget(messageId)
        })
    })
  }
  const nameOf = (bufferId?: string): string => {
    const name = buffers.find((b) => b.id === bufferId)?.name ?? ''
    return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  }

  const tabs: Tab[] = ['threads', 'saved', ...(server?.licensed ? (['bookmarks'] as Tab[]) : []), ...(server?.scheduled ? (['scheduled'] as Tab[]) : []), 'drafts']

  return (
    <>
      <span ref={anchor} className="header-anchor">
        <IconButton
          name="dashboard"
          title="Threads, saved posts, bookmarks and drafts"
          className={open ? 'active' : undefined}
          onClick={() => {
            if (open) setOpen(false)
            else {
              setOpen(true)
              load(tab)
            }
          }}
        />
      </span>
      {open && (
        <HeaderPopover anchor={anchor.current} width={440} onClose={() => setOpen(false)}>
          <div className="mattermost-tools">
          <div className="search-scope small">
            {tabs.map((t) => (
              <button key={t} type="button" className={classes('link-button', tab === t && 'active')} onClick={() => load(t)}>
                {LABELS[t]}
              </button>
            ))}
          </div>
          {rows === null && <div className="small muted">Looking…</div>}
          {rows?.length === 0 && <div className="small muted">Nothing here.</div>}

          {tab === 'threads' &&
            (rows as ThreadRow[] | null)?.map((t) => (
              <div key={t.id} className="pinned-row">
                <button type="button" className="history-row" onClick={() => go(t.bufferId, undefined, t.id)}>
                  <span className="small">
                    <span className="search-result-from">{t.root?.from ?? ''}</span> <span className="muted">in {nameOf(t.bufferId)}</span>{' '}
                    <span className={t.unreadReplies > 0 ? '' : 'muted'}>
                      · {t.replies === 1 ? '1 reply' : `${t.replies} replies`}
                      {t.unreadReplies > 0 ? `, ${t.unreadReplies} new` : ''}
                      {t.unreadMentions > 0 ? `, ${t.unreadMentions} mentioning you` : ''}
                    </span>
                  </span>
                  <span className="small ellipsis">{firstLine(t.root?.body)}</span>
                </button>
                <IconButton
                  name="notifications_off"
                  size={14}
                  title="Stop following this thread"
                  onClick={() => {
                    setRows((current) => (current as ThreadRow[]).filter((x) => x.id !== t.id))
                    void call('followThread', { threadId: t.id, follow: false }).catch((e: Error) => store.toast('error', e.message))
                  }}
                />
              </div>
            ))}

          {tab === 'saved' &&
            (rows as Message[] | null)?.map((m) => (
              <div key={m.id} className="pinned-row">
                <button type="button" className="history-row" onClick={() => go(m.bufferId, m.id)}>
                  <span className="small">
                    <span className="search-result-from">{m.from}</span> <span className="muted">in {nameOf(m.bufferId)} · {m.ts ? formatFullTime(m.ts) : ''}</span>
                  </span>
                  <span className="small ellipsis">{firstLine(m.body)}</span>
                </button>
                <IconButton
                  name="bookmark_remove"
                  size={14}
                  title="Unsave this"
                  onClick={() => {
                    setRows((current) => (current as Message[]).filter((x) => x.id !== m.id))
                    void call('setSaved', { messageId: m.id, saved: false }).catch((e: Error) => store.toast('error', e.message))
                  }}
                />
              </div>
            ))}

          {tab === 'bookmarks' && (
            <>
              {(rows as Bookmark[] | null)?.map((b) => (
                <div key={b.id} className="pinned-row">
                  <button type="button" className="history-row" onClick={() => b.url && void window.moho.openExternal(b.url)}>
                    <span className="small search-result-from">{b.name}</span>
                    <span className="small ellipsis muted">{b.url ?? (b.kind === 'file' ? 'A file' : '')}</span>
                  </button>
                  <IconButton
                    name="close"
                    size={14}
                    title="Remove this bookmark"
                    onClick={() => {
                      setRows((current) => (current as Bookmark[]).filter((x) => x.id !== b.id))
                      void call('setBookmark', { id: b.id, remove: true }).catch((e: Error) => store.toast('error', e.message))
                    }}
                  />
                </div>
              ))}
              <div className="field-row">
                <input className="text-field" placeholder="Name" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
                <input className="text-field" placeholder="https://" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                <button
                  type="button"
                  className="button"
                  disabled={!linkName.trim() || !/^https?:\/\//.test(linkUrl.trim())}
                  onClick={() =>
                    void call('setBookmark', { name: linkName.trim(), url: linkUrl.trim() })
                      .then(() => {
                        setLinkName('')
                        setLinkUrl('')
                        load('bookmarks')
                      })
                      .catch((e: Error) => store.toast('error', e.message))
                  }
                >
                  Add
                </button>
              </div>
            </>
          )}

          {tab === 'scheduled' && (
            <>
              {(rows as Scheduled[] | null)?.map((p) => (
                <div key={p.id} className="pinned-row">
                  <div className="history-row">
                    <span className="small">
                      <span className="muted">
                        {nameOf(p.bufferId)} · {p.at ? formatFullTime(p.at) : ''}
                        {p.error ? ` · could not be sent (${p.error})` : ''}
                      </span>
                    </span>
                    <span className="small ellipsis">{firstLine(p.text)}</span>
                  </div>
                  <IconButton
                    name="close"
                    size={14}
                    title="Take this back"
                    onClick={() => {
                      setRows((current) => (current as Scheduled[]).filter((x) => x.id !== p.id))
                      void call('unschedule', { id: p.id }).catch((e: Error) => store.toast('error', e.message))
                    }}
                  />
                </div>
              ))}
              <div className="small muted">Schedule a post here:</div>
              <div className="field-row">
                <input className="text-field" placeholder="What to say" value={text} onChange={(e) => setText(e.target.value)} />
                <input className="text-field" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                <button
                  type="button"
                  className="button"
                  disabled={!text.trim() || !when}
                  onClick={() =>
                    void call('schedule', { text: text.trim(), at: Math.floor(new Date(when).getTime() / 1000) })
                      .then(() => {
                        setText('')
                        setWhen('')
                        load('scheduled')
                      })
                      .catch((e: Error) => store.toast('error', e.message))
                  }
                >
                  Schedule
                </button>
              </div>
            </>
          )}

          {tab === 'drafts' &&
            (rows as Draft[] | null)?.map((d) => (
              <div key={`${d.bufferId}|${d.rootId ?? ''}`} className="pinned-row">
                <button type="button" className="history-row" onClick={() => go(d.bufferId, undefined, d.rootId || undefined)}>
                  <span className="small muted">
                    {nameOf(d.bufferId)}
                    {d.rootId ? ' · in a thread' : ''} · {d.updated ? formatFullTime(d.updated) : ''}
                  </span>
                  <span className="small ellipsis">{firstLine(d.text)}</span>
                </button>
              </div>
            ))}
          </div>
        </HeaderPopover>
      )}
    </>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useMediaUrl } from '../lib/route'
import { useChat, useStore } from '../state/hooks'
import { classes } from '../lib/util'
import { filterPosts, postAge, type ForumPost } from '../lib/forum'
import { formatMessage } from '../lib/format'
import { RichText } from '../lib/richtext'
import type { BufferEntry } from '../state/store'

interface ForumTag {
  id: string
  name: string
  emoji?: string | null
  moderated?: boolean
}

interface Page {
  posts: ForumPost[]
  hasMore: boolean
  total?: number | null
  tags: ForumTag[]
}

/**
 * A Discord forum: a list of posts, each of which is a thread.
 *
 * Not a conversation, so it is not drawn as one - there is nothing in it to
 * scroll back through and nowhere to type. What it holds is the posts, and
 * what is worth seeing of each is the title, the words that began it, how many
 * have answered, how long ago, and a picture if there was one. Opening a post
 * opens it as the conversation it is, in the list under this forum.
 */
export function ForumPane({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const media = useMediaUrl(buffer.accountId)
  const cached = useChat((s) => s.forumPages)[buffer.id]
  const [posts, setPosts] = useState<ForumPost[]>(cached?.posts ?? [])
  const [tags, setTags] = useState<ForumTag[]>(cached?.tags ?? [])
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false)
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<'active' | 'created'>(cached?.sort ?? 'active')
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState('')
  const [writing, setWriting] = useState(false)

  const load = useCallback(
    (offset: number) => {
      setLoading(true)
      setError('')
      void window.moho
        .rpc<Page>('listForumPosts', { bufferId: buffer.id, sort, offset })
        .then((page) => {
          setHasMore(page.hasMore)
          setTags(page.tags ?? [])
          setPosts((had) => {
            const next = offset === 0 ? page.posts : [...had, ...page.posts.filter((p) => !had.some((h) => h.id === p.id))]
            store.setForumPage(buffer.id, { at: Date.now(), sort, posts: next, hasMore: page.hasMore, tags: page.tags ?? [] })
            return next
          })
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buffer.id, sort]
  )

  useEffect(() => {
    setQuery('')
    // As it was left, if that was a moment ago and the same sort.
    const fresh = cached && cached.sort === sort && Date.now() - cached.at < 60_000
    if (fresh) {
      setPosts(cached.posts)
      setHasMore(cached.hasMore)
      setTags(cached.tags)
      setLoading(false)
      return
    }
    setPosts([])
    load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const open = (post: ForumPost): void => {
    if (opening) return
    setOpening(post.id)
    void window.moho
      .rpc<{ bufferId: string }>('openDiscordThread', { bufferId: buffer.id, threadId: post.id })
      .then((answer) => store.selectBuffer(answer.bufferId, true))
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setOpening(''))
  }

  const shown = useMemo(() => filterPosts(posts, query), [posts, query])
  const live = shown.filter((p) => !p.archived || p.pinned)
  const older = shown.filter((p) => p.archived && !p.pinned)

  const card = (post: ForumPost): JSX.Element => (
    <button
      key={post.id}
      type="button"
      className={classes('forum-post', post.archived && 'older', opening === post.id && 'opening')}
      onClick={() => open(post)}
    >
      <span className="forum-post-main">
        <span className="forum-post-title">
          {post.pinned && <Icon name="push_pin" size={14} className="forum-pin" />}
          {post.name}
        </span>
        {!!post.tags.length && (
          <span className="forum-post-tags">
            {post.tags.map((t) => (
              <span key={t.name} className="forum-tag small">
                {t.emoji ? `${t.emoji} ` : ''}
                {t.name}
              </span>
            ))}
          </span>
        )}
        {(post.author || post.content) && (
          <span className="forum-post-text small">
            {post.author && <strong>{post.author}: </strong>}
            <RichText html={formatMessage(post.content)} ownMarkup onOpenLink={() => {}} />
          </span>
        )}
        <span className="forum-post-meta small muted">
          <span className="forum-post-count">
            <Icon name="chat_bubble" size={13} /> {post.messageCount.toLocaleString()}
          </span>
          {post.reaction && (
            <span>
              {post.reaction.emoji.startsWith('<') ? '' : post.reaction.emoji} {post.reaction.count}
            </span>
          )}
          <span>{postAge(post.lastTs || post.createdTs)}</span>
        </span>
      </span>
      {post.thumbnail && <img className="forum-post-thumb" src={media(post.thumbnail)} alt="" loading="lazy" />}
    </button>
  )

  return (
    <div className="forum-pane">
      <div className="forum-bar">
        <label className="forum-search">
          <Icon name="search" size={18} />
          <input
            placeholder="Search posts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search posts"
          />
        </label>
        <button type="button" className="button primary" onClick={() => setWriting(true)}>
          <Icon name="add_comment" size={16} /> New Post
        </button>
      </div>
      <div className="forum-sorts" role="radiogroup" aria-label="Sort posts">
        {(
          [
            ['active', 'Recently active'],
            ['created', 'Date posted']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={sort === id}
            className={classes('service-chip', sort === id && 'active')}
            onClick={() => setSort(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="forum-list">
        {error && <p className="small error-text">{error}</p>}
        {live.map(card)}
        {older.length > 0 && <div className="forum-older small muted">Older posts</div>}
        {older.map(card)}
        {!loading && !error && shown.length === 0 && (
          <div className="forum-empty muted">
            <Icon name="forum" size={32} />
            <p>{query ? 'No posts match that.' : 'No posts yet. Be the first.'}</p>
          </div>
        )}
        {loading && <p className="small muted forum-loading"><span className="spinner" /> Reading the forum…</p>}
        {!loading && hasMore && !query && (
          <button type="button" className="button subtle forum-more" onClick={() => load(posts.length)}>
            Show more posts
          </button>
        )}
      </div>

      {writing && (
        <NewPost
          buffer={buffer}
          tags={tags}
          onClose={() => setWriting(false)}
          onMade={(bufferId) => {
            setWriting(false)
            void store.selectBuffer(bufferId, true)
          }}
        />
      )}
    </div>
  )
}

/** The form for a new post: its title, what it says, and any tags the forum offers. */
function NewPost({
  buffer,
  tags,
  onClose,
  onMade
}: {
  buffer: BufferEntry
  tags: ForumTag[]
  onClose: () => void
  onMade: (bufferId: string) => void
}): JSX.Element {
  const store = useStore()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const ready = title.trim() !== '' && body.trim() !== '' && !sending

  const send = (): void => {
    if (!ready) return
    setSending(true)
    void window.moho
      .rpc<{ bufferId: string }>('createForumPost', { bufferId: buffer.id, title: title.trim(), body, tags: chosen })
      .then((answer) => onMade(answer.bufferId))
      .catch((e: Error) => {
        setSending(false)
        store.toast('error', e.message)
      })
  }

  return (
    <Modal title="New post" icon="add_comment" className="forum-new" onClose={onClose}>
      <label className="field">
        <span className="small muted">Title</span>
        <input className="text-field" value={title} maxLength={100} placeholder="What is this about?" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="small muted">Message</span>
        <textarea
          className="reason-prompt-box"
          rows={6}
          value={body}
          placeholder="Say more…"
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {tags.length > 0 && (
        <div className="field">
          <span className="small muted">Tags</span>
          <div className="forum-new-tags">
            {tags
              .filter((t) => !t.moderated)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={chosen.includes(t.id)}
                  className={classes('service-chip', chosen.includes(t.id) && 'active')}
                  onClick={() => setChosen(chosen.includes(t.id) ? chosen.filter((c) => c !== t.id) : [...chosen, t.id])}
                >
                  {t.emoji ? `${t.emoji} ` : ''}
                  {t.name}
                </button>
              ))}
          </div>
        </div>
      )}
      <div className="field-row">
        <button type="button" className="button subtle" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button primary" disabled={!ready} onClick={send}>
          {sending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </Modal>
  )
}

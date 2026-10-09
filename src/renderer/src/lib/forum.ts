/** How long ago, the way a forum's list says it: "8d ago", ">30d ago". */
export function postAge(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.floor(now / 1000) - ts)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  const days = Math.floor(secs / 86400)
  return days > 30 ? '>30d ago' : `${days}d ago`
}

/** One post as the daemon describes it. */
export interface ForumPost {
  id: string
  name: string
  author: string
  avatarUrl?: string | null
  content: string
  createdTs: number
  lastTs: number
  messageCount: number
  archived: boolean
  pinned: boolean
  tags: { name: string; emoji?: string | null }[]
  thumbnail?: string | null
  reaction?: { emoji: string; count: number } | null
}

/**
 * The posts a search keeps: those whose title, words or tags hold what was
 * typed, every word of it. Pinned ones stay first, as they do in the forum.
 */
export function filterPosts(posts: ForumPost[], query: string): ForumPost[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const kept = words.length
    ? posts.filter((p) => {
        const hay = `${p.name} ${p.content} ${p.author} ${p.tags.map((t) => t.name).join(' ')}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    : posts
  return [...kept].sort((a, b) => Number(b.pinned) - Number(a.pinned))
}

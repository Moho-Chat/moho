import { useState } from 'react'
import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import type { Embed } from '../../../shared/wire'

/**
 * A link to a server that somebody said, drawn as what it leads to - its picture, its name, how many are in it - with the
 * button to join, as Stoat's own app draws it, on this client's own surfaces. The daemon asks Stoat what the link leads to
 * and sends the card (nobilis/src/backend/stoat/invites.rs); whether the person is in it already is read here from the
 * rail, so the button is right the moment they join, wherever they joined.
 */
export function InviteCard({ embed, accountId }: { embed: Embed; accountId: string }): JSX.Element {
  const store = useStore()
  const groups = useChat((s) => s.groups)
  const [asked, setAsked] = useState(false)
  const joined = embed.target ? groups.some((g) => g.id === `${accountId}|server:${embed.target}`) : embed.cta?.label === 'Joined'
  const link = embed.cta?.url ?? embed.url
  return (
    <div className="invite-card selectable">
      <Avatar name={embed.title ?? '?'} url={embed.imageUrl} size={48} accountId={accountId} />
      <div className="invite-card-text">
        <div className="invite-card-name ellipsis" title={embed.title}>
          {embed.title}
        </div>
        {embed.description && <div className="small muted ellipsis">{embed.description}</div>}
      </div>
      <button
        type="button"
        className="button primary invite-card-join"
        disabled={joined || asked || !link}
        onClick={() => {
          if (!link) return
          setAsked(true)
          void store.joinAndOpen(accountId, link).finally(() => setAsked(false))
        }}
      >
        {joined ? 'Joined' : asked ? 'Joining…' : 'Join'}
      </button>
    </div>
  )
}

import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import { embedColor } from '../lib/format'
import { nickColor } from '../lib/util'
import type { Embed } from '../../../shared/wire'

/** The embed kinds the daemon draws as these cards instead of as a link preview. */
export const KICK_EVENT_KINDS = ['kicks', 'gift-sub', 'raid', 'redeem', 'subscribe', 'moderation', 'stream', 'raid-out']

export function isKickEvent(embed: Embed): boolean {
  return !!embed.kind && KICK_EVENT_KINDS.includes(embed.kind)
}

/** Kick's own mark: a K on a disc. Drawn rather than fetched - it is a few shapes. */
function KicksMark({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <span className="kicks-mark" style={{ width: size, height: size, fontSize: size * 0.68 }} aria-hidden="true">
      K
    </span>
  )
}

/**
 * What somebody did on a Kick stream, as the card Kick draws it - a bar down
 * the edge, a mark for what it was, who did it in bold, and the words - on this
 * client's own surfaces and tokens rather than Kick's page.
 *
 * Every kind of event a Kick channel has, all from the daemon
 * (nobilis/src/backend/kick/chat.rs): KICKs sent, a subscription and one gifted
 * to somebody, a raid, a channel reward redeemed - which keeps the colour the
 * streamer gave it - a ban, a timeout or a chat cleared, and the stream going
 * live or ending.
 */
export function KickEventCard({ embed, bufferId }: { embed: Embed; bufferId?: string }): JSX.Element | null {
  const store = useStore()
  const who = embed.author
  if (!who) return null
  const name = (colour?: string): JSX.Element => (
    <strong className="kick-event-name" style={{ color: colour ?? embed.authorColor ?? nickColor(who) }}>
      {who}
    </strong>
  )
  const accent = embedColor(embed.color) || undefined
  const tint = accent ? ({ '--kick-accent': accent } as React.CSSProperties) : undefined

  if (embed.kind === 'kicks') {
    return (
      <div className="kick-event kicks selectable" style={tint}>
        <div className="kick-event-main">
          <div className="kick-event-line">
            {name()}
            <span className="kick-event-verb">sent</span>
            <KicksMark />
            <strong className="kick-event-amount">{embed.title}</strong>
            {embed.provider && <span className="kick-event-gift small muted">{embed.provider}</span>}
          </div>
          {embed.description && <div className="kick-event-message">{embed.description}</div>}
        </div>
        <span className="kick-event-badge">
          <KicksMark size={30} />
        </span>
      </div>
    )
  }

  if (embed.kind === 'raid') {
    return (
      <div className="kick-event raid selectable">
        <span className="kick-event-badge lead">
          <Icon name="groups" size={20} />
        </span>
        <div className="kick-event-main">
          <div className="kick-event-line">
            {name()}
            <span className="kick-event-verb">
              {embed.title ? 'has raided with' : 'has raided the channel'}
            </span>
            {embed.title && (
              <>
                <strong className="kick-event-amount">{embed.title}</strong>
                <span className="kick-event-verb">{embed.title === '1' ? 'viewer.' : 'viewers.'}</span>
              </>
            )}
          </div>
          {embed.description && <div className="kick-event-message">{embed.description}</div>}
        </div>
      </div>
    )
  }

  // Twitch: the channel being watched is sending its viewers to another (the embed's title is how many, its
  // description the other channel's login), and the card offers to go along.
  if (embed.kind === 'raid-out') {
    const account = bufferId ? store.accountFor(bufferId) : undefined
    return (
      <div className="kick-event raid selectable">
        <span className="kick-event-badge lead">
          <Icon name="groups" size={20} />
        </span>
        <div className="kick-event-main">
          <div className="kick-event-line">
            <span className="kick-event-verb">Raiding</span>
            {name()}
            {embed.title && (
              <>
                <span className="kick-event-verb">with</span>
                <strong className="kick-event-amount">{embed.title}</strong>
                <span className="kick-event-verb">{embed.title === '1' ? 'viewer.' : 'viewers.'}</span>
              </>
            )}
          </div>
          {account && embed.description && (
            <div className="kick-event-message">
              <button type="button" className="button subtle" onClick={() => void store.joinAndOpen(account.id, embed.description ?? '')}>
                Open {who}'s chat
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (embed.kind === 'redeem') {
    return (
      <div className="kick-event redeem selectable" style={tint}>
        <span className="kick-event-badge lead">
          <Icon name="stars" size={22} />
        </span>
        <div className="kick-event-main">
          {name(accent)}
          <div className="kick-event-line">
            <span className="kick-event-verb">has redeemed</span>
            <strong>{embed.title}</strong>
          </div>
          {embed.description && <div className="kick-event-message">{embed.description}</div>}
        </div>
      </div>
    )
  }

  if (embed.kind === 'subscribe') {
    return (
      <div className="kick-event subscribe selectable">
        <span className="kick-event-badge lead">
          <Icon name="workspace_premium" size={22} />
        </span>
        <div className="kick-event-line">
          {name()}
          <span className="kick-event-verb">subscribed</span>
          {embed.title && (
            <>
              <span className="kick-event-verb">-</span>
              <strong>{embed.title}</strong>
              <span className="kick-event-verb">months</span>
            </>
          )}
        </div>
      </div>
    )
  }

  if (embed.kind === 'moderation') {
    return (
      <div className="kick-event moderation selectable">
        <span className="kick-event-badge lead">
          <Icon name="gavel" size={20} />
        </span>
        <div className="kick-event-line">
          <strong className="kick-event-name">{who}</strong>
          <span className="kick-event-verb">{embed.title}</span>
          {embed.description && (
            <>
              <span className="kick-event-verb">by</span>
              <strong>{embed.description}</strong>
            </>
          )}
        </div>
      </div>
    )
  }

  if (embed.kind === 'stream') {
    const live = embed.icon === 'live'
    return (
      <div className={`kick-event stream selectable ${live ? 'live' : 'offline'}`}>
        <span className="kick-event-badge lead">
          <Icon name={live ? 'sensors' : 'sensors_off'} size={20} />
        </span>
        <div className="kick-event-line">
          <strong className="kick-event-name">{who}</strong>
          <span className="kick-event-verb">{embed.title}</span>
        </div>
      </div>
    )
  }

  const count = Number(embed.title) || 1
  const recipients = (embed.description ?? '').split('\n').filter(Boolean)
  return (
    <div className="kick-event gift selectable">
      <span className="kick-event-badge lead">
        <Icon name="redeem" size={22} />
      </span>
      <div className="kick-event-main">
        <div className="kick-event-line">
          {name()}
          <span className="kick-event-verb">gifted {count === 1 ? 'a sub' : `${count} subs`}</span>
          {recipients.length === 1 && (
            <>
              <span className="kick-event-verb">to</span>
              <strong style={{ color: nickColor(recipients[0]) }}>{recipients[0]}</strong>
            </>
          )}
        </div>
        {recipients.length > 1 && (
          <div className="kick-event-recipients">
            <span className="kick-event-verb">to</span>
            {recipients.map((r) => (
              <strong key={r} className="kick-event-recipient" style={{ color: nickColor(r) }}>
                {r}
              </strong>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

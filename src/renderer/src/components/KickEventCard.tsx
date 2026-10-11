import { Icon } from './Icon'
import { embedColor } from '../lib/format'
import { nickColor } from '../lib/util'
import type { Embed } from '../../../shared/wire'

/** The embed kinds the daemon draws as these cards instead of as a link preview. */
export const KICK_EVENT_KINDS = ['kicks', 'gift-sub', 'raid', 'redeem']

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
 * Four kinds, all from the daemon (nobilis/src/backend/kick/chat.rs): KICKs
 * sent, subscriptions gifted and to whom, a raid, and a channel reward
 * redeemed - which keeps the colour the streamer gave it.
 */
export function KickEventCard({ embed }: { embed: Embed }): JSX.Element | null {
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
        <span className="kick-event-badge">
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

  if (embed.kind === 'redeem') {
    return (
      <div className="kick-event redeem selectable" style={tint}>
        <span className="kick-event-badge">
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

  const count = Number(embed.title) || 1
  const recipients = (embed.description ?? '').split('\n').filter(Boolean)
  return (
    <div className="kick-event gift selectable">
      <span className="kick-event-badge">
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

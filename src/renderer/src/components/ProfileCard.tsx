import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SafetyNumberCompare } from './SafetyNumberCompare'
import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { classes, hasDirectMessages, nickColor, serviceLabel } from '../lib/util'
import { presenceColor, presenceLabel } from '../lib/presence'
import { profileActivity } from '../lib/activity'
import { useEscapeLayer } from '../lib/layers'
import { holdProfileHover, releaseProfileHover } from '../lib/profilehover'
import { ActivityLine } from './ActivityLine'

/**
 * Who somebody is, whichever service they belong to (#339: the popover with a cover).
 *
 * Opens beside the name or avatar it was asked from rather than in the middle of the window, so it reads as being
 * about that person; the same card opens on hovering over the name for a moment, showing the top of itself, and
 * pressing it (or More) keeps it open with everything.
 *
 * A card rather than lines in the conversation, which is how IRC clients have always shown a WHOIS: this is an
 * answer to a question asked a second ago, not something that was said.
 *
 * Every row is conditional because every service answers a different subset - IRC has an idle time and no account
 * age, Discord has the day the account was made and no idleness, Matrix has a power level. A card with empty rows
 * would say the service failed to answer rather than that it does not keep that.
 */
export function ProfileCard(): JSX.Element | null {
  const profile = useChat((s) => s.profile)
  const anchor = useChat((s) => s.profileAnchor)
  const hovering = useChat((s) => s.profileHover)
  const presence = useChat((s) => s.presenceByBuffer)
  const buffers = useChat((s) => s.buffers)
  const activeBufferId = useChat((s) => s.activeBufferId)
  const store = useStore()
  /** Comparing the safety number by QR code (Signal). */
  const [comparing, setComparing] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  useEscapeLayer(() => store.closeProfile(), !!profile && !hovering)

  // Beside what it was opened from: to its right where there is room, else to its left; kept inside the window.
  useLayoutEffect(() => {
    const el = card.current
    if (!profile || !el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8
    if (!anchor) {
      setPlace({ left: Math.max(gap, (vw - width) / 2), top: Math.max(gap, vh * 0.12) })
      return
    }
    let left = anchor.x + anchor.w + gap
    if (left + width > vw - gap) left = anchor.x - width - gap
    left = Math.min(Math.max(gap, left), vw - width - gap)
    const top = Math.min(Math.max(gap, anchor.y - 12), vh - height - gap)
    setPlace({ left, top })
  }, [profile, anchor, hovering])

  if (!profile) return null

  // Their status: how they are showing and what they are doing. An away message is words they wrote for this, so
  // it stands in for an activity where the service gave none.
  const activity = profileActivity(profile, presence, buffers) ?? (profile.away ? ({ kind: 'custom', text: profile.away } as const) : undefined)
  const rows: [string, string][] = []
  // The handle is under the name already; a longer address (an IRC mask) is worth a row of its own.
  if (profile.handle && profile.handle !== profile.name && profile.handle.length > 24) rows.push(['Address', profile.handle])
  if (profile.joinedTs) rows.push([joinedLabel(profile.service), day(profile.joinedTs)])
  if (profile.createdTs) rows.push(['Account made', day(profile.createdTs)])
  if (profile.lastActiveTs) rows.push(['Last seen', seen(profile.lastActiveTs)])
  if (profile.idleSeconds !== undefined) rows.push(['Idle', describeIdle(profile.idleSeconds)])
  for (const extra of profile.extra ?? []) rows.push([extra.label, extra.value])
  // Hovering shows the top of the card: who, what they are doing, their standing, the actions, two facts.
  const shownRows = hovering ? rows.slice(0, 2) : rows
  const roles = profile.roles ?? []
  const shownRoles = hovering && roles.length > 3 ? roles.slice(0, 2) : roles
  const isSelf = profile.accountId && store.getSnapshot().accounts.find((a) => a.id === profile.accountId)?.displayName === profile.name
  const canMessage = hasDirectMessages(profile.service) && !isSelf
  const canCall = profile.service === 'discord' && !!profile.id && !isSelf
  const handleLine = [profile.handle && profile.handle !== profile.name && profile.handle.length <= 24 ? profile.handle : null, serviceLabel(profile.service), profile.isModerator ? 'moderator here' : null].filter(Boolean).join(' · ')
  const pin = (): void => store.pinProfile()

  const body = (
    <div
      ref={card}
      className={classes('profile-card', hovering && 'hovering')}
      role="dialog"
      aria-label={profile.name}
      style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
      onMouseEnter={hovering ? holdProfileHover : undefined}
      onMouseLeave={hovering ? releaseProfileHover : undefined}
      // Hovering, a press keeps it open; pinned, a press inside must not reach the scrim behind it.
      onMouseDown={hovering ? pin : (e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="profile-cover" style={{ background: `linear-gradient(120deg, ${nickColor(profile.name)}, color-mix(in srgb, ${nickColor(profile.name)} 40%, var(--surface-container-high)))` }}>
        {!hovering && <IconButton name="close" title="Close" className="profile-close" onClick={() => store.closeProfile()} />}
      </div>
      <div className="profile-body">
        <div className="profile-avatar">
          <Avatar name={profile.name} url={profile.avatarUrl} size={64} status={profile.status} accountId={profile.accountId} />
        </div>
        <div className="profile-title">
          <span className="profile-name ellipsis" title={profile.name}>
            {profile.name}
          </span>
          <span className="small muted ellipsis">{handleLine}</span>
          {profile.status && (
            <span className="profile-status-presence small">
              <span className="profile-status-dot" style={{ background: presenceColor(profile.status) }} />
              {presenceLabel(profile.status)}
            </span>
          )}
        </div>

        {activity?.text && (
          <div className="profile-activity">
            <ActivityLine activity={activity} />
          </div>
        )}

        {/* Their standing, in the service's own words - "Operator in #channel", "Admin", a subscriber badge. */}
        {shownRoles.length > 0 && (
          <div className="profile-roles">
            {shownRoles.map((role) => (
              <span key={role} className="profile-role small">
                {role}
              </span>
            ))}
            {shownRoles.length < roles.length && <span className="profile-role small">+{roles.length - shownRoles.length}</span>}
          </div>
        )}

        <div className="profile-acts">
          {canMessage && (
            <button
              type="button"
              className="profile-act"
              onClick={() => {
                store.closeProfile()
                void store.openDirectMessage(profile.accountId, profile.id ?? '', profile.name)
              }}
            >
              <Icon name="chat" size={20} />
              Message
            </button>
          )}
          {canCall && (
            <button
              type="button"
              className="profile-act"
              onClick={() => {
                store.closeProfile()
                store.toast('info', `Calling ${profile.name}…`)
                void window.moho
                  .rpc<{ bufferId: string }>('callDiscordUser', { accountId: profile.accountId, userId: profile.id })
                  .then((r) => (r?.bufferId ? store.selectBuffer(r.bufferId) : undefined))
                  .catch((e: Error) => store.toast('error', e.message))
              }}
            >
              <Icon name="call" size={20} />
              Call
            </button>
          )}
          {!isSelf && activeBufferId && (
            <button
              type="button"
              className="profile-act"
              onClick={() => {
                store.closeProfile()
                store.startReply('', profile.name, '')
              }}
            >
              <Icon name="alternate_email" size={20} />
              Mention
            </button>
          )}
          {hovering && (
            <button type="button" className="profile-act" onClick={pin}>
              <Icon name="more_horiz" size={20} />
              More
            </button>
          )}
        </div>

        {shownRows.length > 0 && (
          <dl className="profile-rows">
            {shownRows.map(([label, value]) => (
              <div key={label + value} className="profile-row">
                <dt className="small muted">{label}</dt>
                <dd className="ellipsis" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {!hovering && (
          <>
            {/* What they have been called, where the service keeps it: Steam does, and a friend who renamed is
                otherwise somebody you no longer recognise. */}
            {!!profile.nameHistory?.length && (
              <section className="profile-section" aria-label="Previous names">
                <span className="section-label">Previous names</span>
                <ul className="profile-name-history">
                  {profile.nameHistory.map((n) => (
                    <li key={n.name + n.when}>
                      <span className="ellipsis" title={n.name}>
                        {n.name}
                      </span>
                      {n.when && <span className="small muted">{n.when}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {/* Shared channels are the useful half of an IRC lookup, and on a well-connected nick there are
                dozens - so they wrap. */}
            {!!profile.channels?.length && (
              <section className="profile-section" aria-label="Channels">
                <span className="section-label">Channels</span>
                <div className="profile-channel-list">
                  {profile.channels.map((c) => (
                    <span key={c} className="profile-channel small">
                      {c}
                    </span>
                  ))}
                </div>
              </section>
            )}
        {/* Vouching for somebody, which is a different thing from checking
            one of your own sessions: it says this really is them, to every
            client of yours and to anybody who trusts you. Matrix only,
            because it is the only protocol here with an identity to sign. */}
        {profile.service === 'matrix' && profile.id && !profile.pending && (
          <div className="button-row profile-actions">
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                void window.moho
                  .rpc('startMatrixUserVerification', {
                    accountId: profile.accountId,
                    userId: profile.id
                  })
                  .then(() => store.closeProfile())
                  .catch((e: Error) => store.toast('error', e.message))
              }}
            >
              <Icon name="person_check" size={15} /> Verify {profile.name}
            </button>
          </div>
        )}

        {/* Signal: marking the safety number verified once it has been compared (in person, or in Signal on both
            phones), and blocking. Both are told to the account's other devices. */}
        {profile.service === 'signal' && profile.id && !profile.pending && profile.signalUnconfirmed && (
          <div className="profile-warning small">
            <Icon name="gpp_maybe" size={15} /> Their safety number changed after you verified it, so nothing is sent to them
            until you compare it again (and mark them verified) or choose to send anyway.{' '}
            <button
              type="button"
              className="button quiet small"
              onClick={() => {
                void window.moho
                  .rpc('signalSendAnyway', { accountId: profile.accountId, userId: profile.id })
                  .then(() => {
                    store.patchProfile({ signalUnconfirmed: false })
                    store.toast('info', `Messages to ${profile.name} go again`)
                  })
                  .catch((e: Error) => store.toast('error', e.message))
              }}
            >
              Send anyway
            </button>
          </div>
        )}
        {/* Fluxer keeps friends and blocks on the account: what can be done about this person, from their card. */}
        {profile.service === 'fluxer' && profile.id && !profile.pending && profile.relationship && (
          <div className="button-row profile-actions">
            {(() => {
              const call = (method: string, params: Record<string, unknown>, relationship: string, said: string): void => {
                void window.moho
                  .rpc(method, { accountId: profile.accountId, ...params })
                  .then(() => {
                    store.patchProfile({ relationship })
                    store.toast('info', said)
                  })
                  .catch((e: Error) => store.toast('error', e.message))
              }
              const r = profile.relationship
              return (
                <>
                  {r === 'None' && profile.handle && (
                    <button type="button" className="button quiet" onClick={() => call('addStoatFriend', { username: profile.handle }, 'Outgoing', `Friend request sent to ${profile.name}`)}>
                      <Icon name="person_add" size={15} /> Add friend
                    </button>
                  )}
                  {r === 'Incoming' && (
                    <button type="button" className="button quiet" onClick={() => call('answerStoatFriendRequest', { userId: profile.id, accept: true }, 'Friend', `You and ${profile.name} are friends`)}>
                      <Icon name="how_to_reg" size={15} /> Accept request
                    </button>
                  )}
                  {r === 'Outgoing' && (
                    <button type="button" className="button quiet" onClick={() => call('answerStoatFriendRequest', { userId: profile.id, accept: false }, 'None', `Request to ${profile.name} taken back`)}>
                      <Icon name="person_cancel" size={15} /> Cancel request
                    </button>
                  )}
                  {r === 'Friend' && (
                    <button type="button" className="button quiet" onClick={() => call('answerStoatFriendRequest', { userId: profile.id, accept: false }, 'None', `${profile.name} is no longer a friend`)}>
                      <Icon name="person_remove" size={15} /> Remove friend
                    </button>
                  )}
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() =>
                      r === 'Blocked'
                        ? call('stoatBlock', { userId: profile.id, block: false }, 'None', `Unblocked ${profile.name}`)
                        : call('stoatBlock', { userId: profile.id, block: true }, 'Blocked', `Blocked ${profile.name}`)
                    }
                  >
                    <Icon name={r === 'Blocked' ? 'lock_open' : 'block'} size={15} /> {r === 'Blocked' ? 'Unblock' : 'Block'}
                  </button>
                </>
              )
            })()}
          </div>
        )}
        {profile.service === 'signal' && profile.id && !profile.pending && profile.signalVerified !== undefined && (
          <div className="button-row profile-actions">
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                const verified = !profile.signalVerified
                void window.moho
                  .rpc('signalVerify', { accountId: profile.accountId, userId: profile.id, verified })
                  .then(() => {
                    store.patchProfile({ signalVerified: verified, signalUnconfirmed: false })
                    store.toast('info', verified ? `${profile.name} is marked verified` : `${profile.name} is no longer marked verified`)
                  })
                  .catch((e: Error) => store.toast('error', e.message))
              }}
            >
              <Icon name={profile.signalVerified ? 'remove_moderator' : 'verified_user'} size={15} />{' '}
              {profile.signalVerified ? 'Clear verification' : 'Mark as verified'}
            </button>
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                const blocked = !profile.signalBlocked
                void window.moho
                  .rpc('signalBlock', { accountId: profile.accountId, id: `p:${profile.id}`, blocked })
                  .then(() => {
                    store.patchProfile({ signalBlocked: blocked })
                    store.toast('info', blocked ? `${profile.name} is blocked: nothing from them is shown` : `${profile.name} is unblocked`)
                  })
                  .catch((e: Error) => store.toast('error', e.message))
              }}
            >
              <Icon name={profile.signalBlocked ? 'lock_open' : 'block'} size={15} /> {profile.signalBlocked ? 'Unblock' : 'Block'}
            </button>
            <button type="button" className="button quiet" title="Show your code and scan theirs" onClick={() => setComparing(true)}>
              <Icon name="qr_code_2" size={15} /> Compare by code
            </button>
            <button
              type="button"
              className="button quiet"
              title="For a conversation whose messages stopped arriving or can't be read: forgets the session with them and starts a new one"
              onClick={() => {
                if (!window.confirm(`Start a fresh secure session with ${profile.name}? Use this when messages with them stopped working.`)) return
                void window.moho
                  .rpc('signalResetSession', { accountId: profile.accountId, userId: profile.id })
                  .then(() => store.toast('info', `A fresh session with ${profile.name} was started`))
                  .catch((e: Error) => store.toast('error', e.message))
              }}
            >
              <Icon name="sync_lock" size={15} /> Fresh session
            </button>
          </div>
        )}

        {comparing && profile.service === 'signal' && profile.id && (
          <SafetyNumberCompare
            accountId={profile.accountId}
            userId={profile.id}
            name={profile.name}
            onClose={() => setComparing(false)}
            onVerified={() => store.patchProfile({ signalVerified: true, signalUnconfirmed: false })}
          />
        )}

          </>
        )}

        {profile.pending && (
          <p className="small muted profile-waiting">
            <span className="spinner" /> Asking {serviceLabel(profile.service)}…
          </p>
        )}

        {!hovering && !profile.pending && rows.length === 0 && !profile.status && !activity && !roles.length && !profile.channels?.length && (
          <p className="small muted">
            <Icon name="info" size={14} /> {serviceLabel(profile.service)} keeps nothing else about them.
          </p>
        )}
      </div>
    </div>
  )

  // Pinned, a press anywhere else puts it away; hovering, it lets the pointer through.
  return createPortal(
    hovering ? body : <div className="profile-scrim" onMouseDown={() => store.closeProfile()}>{body}</div>,
    document.body
  )
}

/** A day, as a person says it: 14 Mar 2023. The full time is for a title, not a card. */
function day(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** When somebody was last seen: how long ago while it is recent, else the day. */
function seen(ts: number): string {
  const ago = Date.now() / 1000 - ts
  if (ago < 120) return 'just now'
  if (ago < 3600) return `${Math.round(ago / 60)} minutes ago`
  if (ago < 86400) return `${Math.round(ago / 3600)} hours ago`
  return day(ts)
}

/** What "joined" means on each service, in its own terms. */
function joinedLabel(service: string): string {
  if (service === 'irc') return 'Connected'
  if (service === 'discord') return 'Joined server'
  if (service === 'fluxer') return 'Joined community'
  return 'Joined'
}

/** Idle time in the units a person would say it in. */
function describeIdle(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { formatFullTime } from '../lib/util'
import { presenceColor, presenceLabel } from '../lib/presence'

/**
 * Who somebody is, whichever service they belong to.
 *
 * A card rather than lines in the conversation, which is how IRC clients have
 * always shown a WHOIS and is the one thing worth changing about it: this is
 * an answer to a question somebody asked a second ago, not something that was
 * said, and putting it in the log means scrolling past it forever afterwards.
 *
 * Every row is conditional because every service answers a different subset -
 * IRC has an idle time and no account age, Discord has the day the account was
 * made and no idleness, Matrix has a power level. A card with empty rows would
 * say the service failed to answer rather than that it does not keep that.
 */
export function ProfileCard(): JSX.Element | null {
  const profile = useChat((s) => s.profile)
  const store = useStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') store.closeProfile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (!profile) return null

  const rows: [string, string][] = []
  if (profile.handle && profile.handle !== profile.name) rows.push(['Address', profile.handle])
  if (profile.away) rows.push(['Away', profile.away])
  if (profile.createdTs) rows.push(['Account made', formatFullTime(profile.createdTs)])
  if (profile.joinedTs) rows.push([joinedLabel(profile.service), formatFullTime(profile.joinedTs)])
  if (profile.lastActiveTs) rows.push(['Last seen', formatFullTime(profile.lastActiveTs)])
  if (profile.idleSeconds !== undefined) rows.push(['Idle', describeIdle(profile.idleSeconds)])
  for (const extra of profile.extra ?? []) rows.push([extra.label, extra.value])

  return createPortal(
    <div className="modal-scrim" onClick={() => store.closeProfile()}>
      <div className="profile-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="profile-head">
          <Avatar name={profile.name} url={profile.avatarUrl} size={40} status={profile.status} />
          <div className="profile-title">
            <span className="profile-name ellipsis">{profile.name}</span>
            <span className="small muted">
              {profile.status ? presenceLabel(profile.status) : profile.service}
              {profile.isModerator ? ' · moderator here' : ''}
            </span>
          </div>
          <IconButton name="close" title="Close" onClick={() => store.closeProfile()} />
        </div>

        {/* Their standing, said plainly. A role list is the service's own
            words for it - "Operator in #channel", "Admin", a subscriber
            badge - so it is shown as given rather than translated. */}
        {!!profile.roles?.length && (
          <div className="profile-roles">
            {profile.roles.map((role) => (
              <span
                key={role}
                className="profile-role small"
                style={profile.isModerator ? { borderColor: presenceColor('dnd') } : undefined}
              >
                {role}
              </span>
            ))}
          </div>
        )}

        <dl className="profile-rows">
          {rows.map(([label, value]) => (
            <div key={label + value} className="profile-row">
              <dt className="small muted">{label}</dt>
              <dd className="ellipsis" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {/* Shared channels are the useful half of an IRC lookup, and on a
            well-connected nick there are dozens - so they wrap. */}
        {!!profile.channels?.length && (
          <div className="profile-channels">
            <span className="small muted">Channels</span>
            <div className="profile-channel-list">
              {profile.channels.map((c) => (
                <span key={c} className="profile-channel small">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Vouching for somebody, which is a different thing from checking
            one of your own sessions: it says this really is them, to every
            client of yours and to anybody who trusts you. Matrix only,
            because it is the only protocol here with an identity to sign. */}
        {profile.service === 'matrix' && profile.id && !profile.pending && (
          <div className="button-row profile-actions">
            <button
              type="button"
              className="button subtle"
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

        {profile.pending && (
          <p className="small muted profile-waiting">
            <span className="spinner" /> Asking {profile.service}…
          </p>
        )}

        {!profile.pending && rows.length === 0 && !profile.roles?.length && !profile.channels?.length && (
          <p className="small muted">
            <Icon name="info" size={14} /> {profile.service} keeps nothing else about them.
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}

/** What "joined" means on each service, in its own terms. */
function joinedLabel(service: string): string {
  if (service === 'irc') return 'Connected'
  if (service === 'discord') return 'Joined server'
  return 'Joined'
}

/** Idle time in the units a person would say it in. */
function describeIdle(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

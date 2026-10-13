import { Modal } from './Modal'
import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { formatFullTime, serviceLabel } from '../lib/util'
import { presenceColor, presenceLabel } from '../lib/presence'
import { profileActivity } from '../lib/activity'
import { ActivityLine } from './ActivityLine'

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
  const presence = useChat((s) => s.presenceByBuffer)
  const buffers = useChat((s) => s.buffers)
  const store = useStore()

  if (!profile) return null

  // Their status, as its own section: how they are showing and what they are
  // doing. An away message is words they wrote for this, so it stands in for
  // an activity where the service gave none.
  const activity = profileActivity(profile, presence, buffers) ?? (profile.away ? ({ kind: 'custom', text: profile.away } as const) : undefined)
  const hasStatus = !!profile.status || !!activity

  const rows: [string, string][] = []
  if (profile.handle && profile.handle !== profile.name) rows.push(['Address', profile.handle])
  if (profile.createdTs) rows.push(['Account made', formatFullTime(profile.createdTs)])
  if (profile.joinedTs) rows.push([joinedLabel(profile.service), formatFullTime(profile.joinedTs)])
  if (profile.lastActiveTs) rows.push(['Last seen', formatFullTime(profile.lastActiveTs)])
  if (profile.idleSeconds !== undefined) rows.push(['Idle', describeIdle(profile.idleSeconds)])
  for (const extra of profile.extra ?? []) rows.push([extra.label, extra.value])

  return (
    <Modal title={profile.name} className="profile-card" onClose={() => store.closeProfile()} header={
        <div className="profile-head">
          <Avatar name={profile.name} url={profile.avatarUrl} size={40} status={profile.status} accountId={profile.accountId} />
          <div className="profile-title">
            <span className="profile-name ellipsis">{profile.name}</span>
            <span className="small muted">
              {serviceLabel(profile.service)}
              {profile.isModerator ? ' · moderator here' : ''}
            </span>
          </div>
          <IconButton name="close" title="Close" onClick={() => store.closeProfile()} />
        </div>
    }>

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

        {/* Status, first of the facts: it is the one that changes while the
            card is open, and the one somebody opens it to see. */}
        {hasStatus && (
          <section className="profile-status" aria-label="Status">
            <span className="small muted profile-section-title">Status</span>
            {profile.status && (
              <span className="profile-status-presence">
                <span className="profile-status-dot" style={{ background: presenceColor(profile.status) }} />
                {presenceLabel(profile.status)}
              </span>
            )}
            {activity && <ActivityLine activity={activity} />}
          </section>
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

        {/* What they have been called, where the service keeps it: Steam does,
            and a friend who renamed is otherwise somebody you no longer recognise. */}
        {!!profile.nameHistory?.length && (
          <section className="profile-status" aria-label="Previous names">
            <span className="small muted profile-section-title">Previous names</span>
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

        {!profile.pending && rows.length === 0 && !hasStatus && !profile.roles?.length && !profile.channels?.length && (
          <p className="small muted">
            <Icon name="info" size={14} /> {profile.service} keeps nothing else about them.
          </p>
        )}
    </Modal>
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

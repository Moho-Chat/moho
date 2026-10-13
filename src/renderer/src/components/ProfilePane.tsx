import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { ActivityLine } from './ActivityLine'
import { useChat, useStore } from '../state/hooks'
import { formatFullTime, formatRelativeTime } from '../lib/util'
import { presenceColor, presenceLabel } from '../lib/presence'

/**
 * Who a conversation is with, in a column where the member list would be.
 *
 * A direct message is one person, so it has no list and its header says little
 * more than a name. This is the rest: how they are showing and what they are
 * playing now, when they were last about, what they have been called, and what
 * they wrote about themselves. What changes while it is open - their status,
 * their game - is read from their presence as it arrives, so it is live; what
 * only has to be asked once - their level, their names - is asked when it opens.
 *
 * Steam's, where every one of these facts is kept; other services answer less
 * and have the card instead.
 */
export function ProfilePane({ bufferId }: { bufferId: string }): JSX.Element | null {
  const buffer = useChat((s) => s.buffers.find((b) => b.id === bufferId))
  const pane = useChat((s) => s.profilePane)
  const member = useChat((s) => (s.presenceByBuffer[bufferId] ?? [])[0])
  const store = useStore()
  if (!buffer) return null
  const profile = pane?.bufferId === bufferId ? pane.profile : null
  const status = member?.status ?? profile?.status
  const offline = !status || status === 'offline'
  const activity = member?.activity ?? profile?.activity ?? undefined
  const lastSeen = offline ? (member?.lastSeen ?? profile?.lastActiveTs) : undefined
  const facts = (profile?.extra ?? []).filter((e) => !['On', 'Doing'].includes(e.label))
  const playing = activity?.kind === 'game' ? activity : undefined
  const names = profile?.nameHistory ?? []

  return (
    <aside className="profile-pane" aria-label={`About ${buffer.name}`}>
      <div className="profile-pane-head">
        <span className="profile-pane-title ellipsis">Profile</span>
        <IconButton name="close" size={16} title="Close" onClick={() => store.closeProfilePane()} />
      </div>
      <div className="profile-pane-scroll">
        <div className="profile-pane-who">
          <Avatar name={buffer.name} url={member?.avatarUrl ?? profile?.avatarUrl ?? buffer.avatarUrl} size={72} status={status} accountId={buffer.accountId} />
          <span className="profile-pane-name">{buffer.name}</span>
          {profile?.name && profile.name !== buffer.name && <span className="small muted">{profile.name}</span>}
        </div>

        <section className="profile-pane-section" aria-label="Status">
          <span className="small muted profile-section-title">Status</span>
          <span className="profile-status-presence">
            <span className="profile-status-dot" style={{ background: presenceColor(status) }} />
            {presenceLabel(status)}
          </span>
          {activity && !playing && <ActivityLine activity={activity} />}
          {member?.client && !offline && <span className="small muted">On {member.client}</span>}
          {lastSeen && (
            <span className="small muted" title={formatFullTime(lastSeen)}>
              Last seen {formatRelativeTime(lastSeen)}
            </span>
          )}
        </section>

        {playing && (
          <section className="profile-pane-section" aria-label="Playing">
            <span className="small muted profile-section-title">Playing</span>
            <span className="profile-pane-game">
              <Icon name="sports_esports" size={16} />
              <span>{playing.text}</span>
            </span>
            {(member?.rich ?? profile?.extra?.find((e) => e.label === 'Doing')?.value) && (
              <span className="small muted">{member?.rich ?? profile?.extra?.find((e) => e.label === 'Doing')?.value}</span>
            )}
          </section>
        )}

        {names.length > 0 && (
          <section className="profile-pane-section" aria-label="Previous names">
            <span className="small muted profile-section-title">Previous names</span>
            <ul className="profile-pane-names">
              {names.map((n) => (
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

        {(facts.length > 0 || profile?.createdTs) && (
          <dl className="profile-rows profile-pane-rows">
            {profile?.createdTs ? (
              <div className="profile-row">
                <dt className="small muted">Member since</dt>
                <dd>{new Date(profile.createdTs * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
              </div>
            ) : null}
            {facts.map((e) => (
              <div key={e.label + e.value} className="profile-row">
                <dt className="small muted">{e.label}</dt>
                <dd title={e.value}>{e.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!profile && (
          <p className="small muted profile-waiting">
            <span className="spinner" /> Asking Steam…
          </p>
        )}
      </div>
    </aside>
  )
}

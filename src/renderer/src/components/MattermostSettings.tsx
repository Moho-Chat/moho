import { useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Asking } from './AccountList'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'
import { classes } from '../lib/util'
import type { BufferEntry } from '../state/store'

/** What the account may do here, as the daemon works it out from its roles (backend/mattermost/manage.rs). */
interface Powers {
  kind?: string
  teamId?: string
  channelProperties?: boolean
  channelMembers?: boolean
  channelRoles?: boolean
  archive?: boolean
  convertToPrivate?: boolean
  convertToPublic?: boolean
  teamMembers?: boolean
  teamRoles?: boolean
  teamInvite?: boolean
  webhooks?: boolean
  moderation?: boolean
  archived?: boolean
  channelAdmin?: boolean
}

interface Settings {
  displayName: string
  name: string
  header: string
  purpose: string
  kind: string
  archived: boolean
  members?: number
  pinned?: number
  powers: Powers
}

interface Member {
  userId: string
  name: string
  username?: string
  admin: boolean
}

interface Hook {
  id: string
  kind: string
  name?: string
  description?: string
  channel?: string
  by?: string
}

interface Moderation {
  name: string
  roles: Record<string, { value: boolean; enabled: boolean }>
}

type Tab = 'channel' | 'members' | 'team' | 'integrations' | 'moderation'

const PERMISSION_WORDS: Record<string, string> = {
  create_post: 'Post messages',
  create_reactions: 'Add reactions',
  manage_members: 'Add and remove members',
  use_channel_mentions: 'Use @channel, @all and @here'
}

/**
 * A Mattermost channel's settings and its team's, from the conversation's header: what the channel is called and says,
 * whether it is open or private, archiving; who is in it and who looks after it; the team's members and admins, its
 * invite link and email invites; its integrations; and who may post or react in the channel. Each part is offered only
 * where the account's roles let it act, and the server has the last word.
 */
export function MattermostSettings({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('channel')
  const [info, setInfo] = useState<Settings | null>(null)
  const [form, setForm] = useState({ displayName: '', header: '', purpose: '' })
  const [members, setMembers] = useState<Member[] | null>(null)
  const [team, setTeam] = useState<Member[] | null>(null)
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [moderation, setModeration] = useState<Moderation[] | null>(null)
  const [invite, setInvite] = useState('')
  const [adding, setAdding] = useState('')
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)

  const manage = <T,>(what: string, params: Record<string, unknown> = {}): Promise<T> => window.moho.rpc<T>('mattermost', { action: 'manage', bufferId: buffer.id, do: what, ...params })
  const failed = (e: Error): void => store.toast('error', e.message)

  const load = (): void => {
    void manage<Settings>('settings')
      .then((s) => {
        setInfo(s)
        setForm({ displayName: s.displayName, header: s.header, purpose: s.purpose })
      })
      .catch((e: Error) => {
        failed(e)
        setOpen(false)
      })
  }
  const show = (which: Tab): void => {
    setTab(which)
    if (which === 'members') void manage<Member[]>('members').then(setMembers).catch(failed)
    if (which === 'team') {
      void manage<Member[]>('teamMembers').then(setTeam).catch(failed)
      if (info?.powers.teamInvite) void manage<{ link: string }>('invite').then((r) => setInvite(r.link)).catch(() => setInvite(''))
    }
    if (which === 'integrations') void manage<Hook[]>('webhooks').then(setHooks).catch(failed)
    if (which === 'moderation') void manage<Moderation[]>('moderation').then(setModeration).catch(failed)
  }
  const act = (what: string, params: Record<string, unknown>, done: string, after?: () => void): void => {
    setBusy(true)
    void manage(what, params)
      .then(() => {
        store.toast('info', done)
        after?.()
      })
      .catch(failed)
      .finally(() => setBusy(false))
  }

  const p = info?.powers ?? {}
  const personal = info?.kind === 'D' || info?.kind === 'G'
  const tabs: Tab[] = personal
    ? ['channel', 'members']
    : ['channel', 'members', 'team', ...(p.webhooks ? (['integrations'] as Tab[]) : []), ...(p.moderation ? (['moderation'] as Tab[]) : [])]
  const words: Record<Tab, string> = { channel: 'Channel', members: 'Members', team: 'Team', integrations: 'Integrations', moderation: 'Permissions' }
  const changed = (['displayName', 'header', 'purpose'] as const).filter((k) => info && form[k] !== info[k])

  return (
    <>
      <span className="header-anchor">
        <IconButton
          name="tune"
          title="Channel settings"
          className={open ? 'active' : undefined}
          onClick={() => {
            if (open) setOpen(false)
            else {
              setOpen(true)
              setInfo(null)
              setTab('channel')
              load()
            }
          }}
        />
      </span>
      {open && (
        <Modal title={info?.displayName || 'Channel settings'} icon="tune" className="room-settings" onClose={() => setOpen(false)}>
          <div className="room-settings-body">
            {!info && <Asking what="Mattermost" />}
            {info && (
              <>
                <div className="search-scope small">
                  {tabs.map((t) => (
                    <button key={t} type="button" className={classes('link-button', tab === t && 'active')} onClick={() => show(t)}>
                      {words[t]}
                    </button>
                  ))}
                </div>

                {tab === 'channel' && (
                  <section className="page-section">
                    <div className="card card-fields">
                      {(['displayName', 'header', 'purpose'] as const).map((k) => (
                        <label key={k} className="field">
                          <span className="field-label">{k === 'displayName' ? 'Name' : k === 'header' ? 'Header' : 'Purpose'}</span>
                          <input className="text-field" value={form[k]} disabled={!p.channelProperties || busy || personal && k === 'displayName'} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                        </label>
                      ))}
                      <div className="field-row">
                        <button type="button" className="button primary" disabled={busy || changed.length === 0} onClick={() => act('patch', Object.fromEntries(changed.map((k) => [k, form[k]])), 'Channel changed', load)}>
                          Save
                        </button>
                      </div>
                      {!p.channelProperties && !personal && <div className="small muted">Only the channel&apos;s admins can change these.</div>}
                      <div className="small muted">
                        {info.kind === 'P' ? 'Private' : info.kind === 'O' ? 'Open to the team' : 'A conversation'}
                        {info.members != null ? ` · ${info.members} members` : ''}
                        {info.pinned ? ` · ${info.pinned} pinned` : ''}
                        {info.archived ? ' · archived' : ''}
                      </div>
                      {(p.convertToPrivate || p.convertToPublic) && (
                        <button type="button" className="button" disabled={busy} onClick={() => act('privacy', { private: info.kind === 'O' }, info.kind === 'O' ? 'Made private' : 'Made open', load)}>
                          {info.kind === 'O' ? 'Make it private' : 'Make it open to the team'}
                        </button>
                      )}
                      {p.archive && !info.archived && (
                        <button type="button" className="button danger" disabled={busy} onClick={() => act('archive', {}, 'Channel archived', () => setOpen(false))}>
                          <Icon name="inventory_2" size={16} /> Archive the channel
                        </button>
                      )}
                      {p.archive && info.archived && (
                        <button type="button" className="button" disabled={busy} onClick={() => act('restore', {}, 'Channel restored', load)}>
                          Restore the channel
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {tab === 'members' && (
                  <section className="page-section">
                    <div className="card">
                      {members === null && <div className="small muted">Looking…</div>}
                      {members?.map((m) => (
                        <div key={m.userId} className="device-row">
                          <Icon name={m.admin ? 'shield_person' : 'person'} size={18} />
                          <div className="setting-text">
                            <div>{m.name}</div>
                            <div className="small muted">
                              @{m.username}
                              {m.admin ? ' · Channel Admin' : ''}
                            </div>
                          </div>
                          {p.channelRoles && (
                            <button type="button" className="button subtle" disabled={busy} onClick={() => act('channelAdmin', { userId: m.userId, admin: !m.admin }, m.admin ? 'No longer an admin' : 'Made a Channel Admin', () => show('members'))}>
                              {m.admin ? 'Remove admin' : 'Make admin'}
                            </button>
                          )}
                          {p.channelMembers && (
                            <button type="button" className="button subtle" disabled={busy} onClick={() => act('removeMember', { userId: m.userId }, 'Removed from the channel', () => show('members'))}>
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                      {p.channelMembers && (
                        <div className="field-row">
                          <input className="text-field" placeholder="username" value={adding} onChange={(e) => setAdding(e.target.value)} />
                          <button type="button" className="button" disabled={busy || !adding.trim()} onClick={() => act('addMember', { userId: adding.trim() }, 'Added to the channel', () => { setAdding(''); show('members') })}>
                            Add
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {tab === 'team' && (
                  <section className="page-section">
                    <div className="card">
                      {p.teamInvite && (
                        <>
                          <div className="setting-row">
                            <div className="setting-text">
                              <div>Invite link</div>
                              <div className="small muted selectable">{invite || 'Not to be had'}</div>
                            </div>
                            {invite && (
                              <button type="button" className="button subtle" onClick={() => void window.moho.copyText(invite).then(() => store.toast('info', 'Link copied'))}>
                                Copy
                              </button>
                            )}
                            {p.teamMembers && (
                              <button type="button" className="button subtle" disabled={busy} onClick={() => void manage<{ link: string }>('newInvite').then((r) => { setInvite(r.link); store.toast('info', 'A new link; the old one no longer works') }).catch(failed)}>
                                New link
                              </button>
                            )}
                          </div>
                          <div className="field-row">
                            <input className="text-field" placeholder="email addresses, separated by commas" value={emails} onChange={(e) => setEmails(e.target.value)} />
                            <button type="button" className="button" disabled={busy || !emails.includes('@')} onClick={() => act('inviteEmail', { emails }, 'Invitations sent', () => setEmails(''))}>
                              Invite
                            </button>
                          </div>
                        </>
                      )}
                      {team === null && <div className="small muted">Looking…</div>}
                      {team?.map((m) => (
                        <div key={m.userId} className="device-row">
                          <Icon name={m.admin ? 'shield_person' : 'person'} size={18} />
                          <div className="setting-text">
                            <div>{m.name}</div>
                            <div className="small muted">
                              @{m.username}
                              {m.admin ? ' · Team Admin' : ''}
                            </div>
                          </div>
                          {p.teamRoles && (
                            <button type="button" className="button subtle" disabled={busy} onClick={() => act('teamAdmin', { userId: m.userId, admin: !m.admin }, m.admin ? 'No longer a Team Admin' : 'Made a Team Admin', () => show('team'))}>
                              {m.admin ? 'Remove admin' : 'Make admin'}
                            </button>
                          )}
                          {p.teamMembers && (
                            <button type="button" className="button subtle" disabled={busy} onClick={() => act('removeTeamMember', { userId: m.userId }, 'Removed from the team', () => show('team'))}>
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {tab === 'integrations' && (
                  <section className="page-section">
                    <div className="card">
                      {hooks === null && <div className="small muted">Looking…</div>}
                      {hooks?.length === 0 && <div className="small muted">No webhooks in this team.</div>}
                      {hooks?.map((h) => (
                        <div key={h.id} className="device-row">
                          <Icon name={h.kind === 'incoming' ? 'call_received' : 'call_made'} size={18} />
                          <div className="setting-text">
                            <div>
                              {h.name || 'Unnamed'} <span className="small muted">· {h.kind} webhook</span>
                            </div>
                            <div className="small muted">
                              {[h.channel ? `in ${h.channel}` : '', h.by ? `made by ${h.by}` : '', h.description ?? ''].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="small muted">Webhooks are made and changed in Mattermost&apos;s own Integrations page.</div>
                    </div>
                  </section>
                )}

                {tab === 'moderation' && (
                  <section className="page-section">
                    <div className="card">
                      {moderation === null && <div className="small muted">Looking…</div>}
                      {moderation?.map((m) => (
                        <div key={m.name} className="setting-row">
                          <div className="setting-text">
                            <div>{PERMISSION_WORDS[m.name] ?? m.name}</div>
                          </div>
                          {(['members', 'guests'] as const)
                            .filter((r) => m.roles[r])
                            .map((r) => (
                              <label key={r} className="small">
                                <input
                                  type="checkbox"
                                  checked={m.roles[r].value}
                                  disabled={busy || !m.roles[r].enabled}
                                  onChange={(e) =>
                                    act('setModeration', { permission: m.name, role: r, on: e.target.checked }, 'Permission changed', () => show('moderation'))
                                  }
                                />{' '}
                                {r}
                              </label>
                            ))}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

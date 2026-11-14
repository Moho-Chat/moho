import { useState } from 'react'
import { IconButton } from './Icon'
import { Modal } from './Modal'
import { ChoiceSetting } from './settings/controls'
import { useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

interface Person {
  userId: string
  nick: string
}

/** What the daemon says about a Signal conversation's settings. */
interface Info {
  dm: boolean
  timer: number
  title?: string
  description?: string
  isAdmin?: boolean
  memberCount?: number
  linkMode?: 'off' | 'on' | 'approval'
  link?: string | null
  whoMayEdit?: 'all' | 'admins'
  whoMayAdd?: 'all' | 'admins'
  members?: (Person & { admin: boolean; me: boolean })[]
  requesting?: Person[]
  pending?: (Person & { mine: boolean })[]
}

/** The lengths Signal's own clients offer, in seconds. */
const TIMERS: { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30 seconds' },
  { value: 300, label: '5 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 28800, label: '8 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
  { value: 2419200, label: '4 weeks' }
]

function timerOptions(current: number): { value: string; label: string }[] {
  const known = TIMERS.some((t) => t.value === current)
  return [...TIMERS, ...(known ? [] : [{ value: current, label: `${current} seconds` }])].map((t) => ({ value: String(t.value), label: t.label }))
}

/**
 * A Signal conversation's settings: for a group, its name, description, timer, link, who may do what, the people asking
 * to join or invited, and leaving; for a conversation with one person, how long its messages last. What only an admin
 * may change is shown to everybody and offered only to admins, so a member can still read what the rules are.
 *
 * Read when opened, and again after each change: the group server is the one that says what is true.
 */
export function SignalGroupSettings({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)

  const load = async (): Promise<void> => {
    try {
      const got = await window.moho.rpc<Info>('signalGroupInfo', { bufferId: buffer.id })
      setInfo(got)
      setTitle(got.title ?? '')
      setDescription(got.description ?? '')
    } catch (e) {
      store.toast('error', (e as Error).message)
      setOpen(false)
    }
  }

  const show = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setInfo(null)
    setConfirmLeave(false)
    void load()
  }

  /** One change, then the settings as they are after it. */
  const change = async (params: Record<string, unknown>, done?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await window.moho.rpc('signalGroup', { bufferId: buffer.id, ...params })
      if (done) store.toast('info', done)
      await load()
      return true
    } catch (e) {
      store.toast('error', `Couldn't change that: ${(e as Error).message}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const setTimer = async (seconds: number): Promise<void> => {
    setBusy(true)
    try {
      await window.moho.rpc('signalSetTimer', { bufferId: buffer.id, seconds })
      await load()
    } catch (e) {
      store.toast('error', `Couldn't change that: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const admin = !!info?.isAdmin
  const mayEdit = admin || info?.whoMayEdit === 'all'
  const mayAdd = admin || info?.whoMayAdd === 'all'

  return (
    <>
      <span className="header-anchor">
        <IconButton name="tune" title={buffer.kind === 'dm' ? 'Disappearing messages' : 'Group settings'} className={open ? 'active' : undefined} onClick={show} />
      </span>
      {open && (
        <Modal title={info?.dm ? 'Conversation settings' : 'Group settings'} icon="tune" className="room-settings" onClose={() => setOpen(false)}>
          <div className="room-settings-body">
            {!info && <div className="small muted">Looking…</div>}
            {info && (
              <ChoiceSetting
                label="Disappearing messages"
                description={
                  info.dm || mayEdit
                    ? 'New messages here disappear this long after they are read. Everybody in the conversation is told.'
                    : 'Only an admin can change this in this group.'
                }
                value={String(info.timer)}
                options={timerOptions(info.timer)}
                disabled={busy || (!info.dm && !mayEdit)}
                onChange={(v) => void setTimer(Number(v))}
              />
            )}
            {info && !info.dm && (
              <>
                <div className="field">
                  <span className="small muted">Name</span>
                  <div className="field-row">
                    <input className="text-field" value={title} disabled={!mayEdit || busy} onChange={(e) => setTitle(e.target.value)} />
                    <button
                      type="button"
                      className="button"
                      disabled={!mayEdit || busy || !title.trim() || title === info.title}
                      onClick={() => void change({ action: 'rename', name: title }, 'The group was renamed')}
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="field">
                  <span className="small muted">Description</span>
                  <div className="field-row">
                    <input className="text-field" value={description} disabled={!mayEdit || busy} onChange={(e) => setDescription(e.target.value)} />
                    <button
                      type="button"
                      className="button"
                      disabled={!mayEdit || busy || description === info.description}
                      onClick={() => void change({ action: 'describe', text: description })}
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="field">
                  <span className="small muted">Picture</span>
                  <div className="field-row">
                    <button
                      type="button"
                      className="button"
                      disabled={!mayEdit || busy}
                      onClick={() =>
                        void window.moho.pickFile(['jpg', 'jpeg', 'png', 'webp', 'gif']).then((path) => {
                          if (path) void change({ action: 'picture', path }, 'The group has a new picture')
                        })
                      }
                    >
                      Choose…
                    </button>
                    {buffer.avatarUrl && (
                      <button
                        type="button"
                        className="button"
                        disabled={!mayEdit || busy}
                        onClick={() => void change({ action: 'picture', path: '' }, 'The picture was taken away')}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <ChoiceSetting
                  label="Group link"
                  description={
                    admin
                      ? 'Anybody with the link can join, or ask to. Resetting it stops the old one working.'
                      : 'Only an admin can change the group link.'
                  }
                  value={info.linkMode ?? 'off'}
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'on', label: 'Anybody with the link joins' },
                    { value: 'approval', label: 'An admin approves who joins' }
                  ]}
                  disabled={!admin || busy}
                  onChange={(mode) => void change({ action: 'link', mode })}
                />
                {admin && info.link && (
                  <div className="field-row">
                    <input className="text-field" readOnly value={info.link} onFocus={(e) => e.target.select()} />
                    <button type="button" className="button" onClick={() => void navigator.clipboard.writeText(info.link ?? '').then(() => store.toast('info', 'Link copied'))}>
                      Copy
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={() => void change({ action: 'resetLink' }, 'The old link no longer works')}>
                      Reset
                    </button>
                  </div>
                )}
                <ChoiceSetting
                  label="Who can change the group's name, description and timer"
                  value={info.whoMayEdit ?? 'all'}
                  options={[
                    { value: 'all', label: 'All members' },
                    { value: 'admins', label: 'Only admins' }
                  ]}
                  disabled={!admin || busy}
                  onChange={(who) => void change({ action: 'whoMayEdit', who })}
                />
                <ChoiceSetting
                  label="Who can add members"
                  value={info.whoMayAdd ?? 'all'}
                  options={[
                    { value: 'all', label: 'All members' },
                    { value: 'admins', label: 'Only admins' }
                  ]}
                  disabled={!admin || busy}
                  onChange={(who) => void change({ action: 'whoMayAdd', who })}
                />

                {mayAdd && (
                  <div className="field">
                    <span className="small muted">Add people</span>
                    <div className="field-row">
                      <input
                        className="text-field"
                        placeholder="Usernames, like name.42, separated by commas"
                        value={adding}
                        disabled={busy}
                        onChange={(e) => setAdding(e.target.value)}
                      />
                      <button
                        type="button"
                        className="button"
                        disabled={busy || !adding.trim()}
                        onClick={() => {
                          const userIds = adding.split(',').map((s) => s.trim()).filter(Boolean)
                          void change({ action: 'add', userIds }, 'Added. Anybody who could not be added straight away was invited').then((ok) => ok && setAdding(''))
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}

                {(info.requesting ?? []).length > 0 && (
                  <div className="field">
                    <span className="small muted">Asking to join</span>
                    {(info.requesting ?? []).map((p) => (
                      <div key={p.userId} className="field-row">
                        <span className="grow">{p.nick}</span>
                        {admin && (
                          <>
                            <button type="button" className="button" disabled={busy} onClick={() => void change({ action: 'approve', userId: p.userId, accept: true })}>
                              Let in
                            </button>
                            <button type="button" className="button" disabled={busy} onClick={() => void change({ action: 'approve', userId: p.userId, accept: false })}>
                              Turn down
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {(info.pending ?? []).length > 0 && (
                  <div className="field">
                    <span className="small muted">Invited</span>
                    {(info.pending ?? []).map((p) => (
                      <div key={p.userId} className="field-row">
                        <span className="grow">{p.nick}</span>
                        {(admin || p.mine) && (
                          <button type="button" className="button" disabled={busy} onClick={() => void change({ action: 'uninvite', userId: p.userId })}>
                            Take back
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="field">
                  <span className="small muted">Members ({info.memberCount ?? 0})</span>
                  {(info.members ?? []).map((m) => (
                    <div key={m.userId} className="field-row">
                      <span className="grow">
                        {m.nick}
                        {m.admin && <span className="small muted"> · admin</span>}
                      </span>
                      {admin && !m.me && (
                        <>
                          <button type="button" className="button" disabled={busy} onClick={() => void change({ action: 'admin', userId: m.userId, admin: !m.admin })}>
                            {m.admin ? 'Remove as admin' : 'Make admin'}
                          </button>
                          <button type="button" className="button" disabled={busy} onClick={() => void change({ action: 'remove', userId: m.userId }, `${m.nick} was removed`)}>
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="field-row">
                  {!confirmLeave ? (
                    <button type="button" className="button danger" disabled={busy} onClick={() => setConfirmLeave(true)}>
                      Leave group
                    </button>
                  ) : (
                    <>
                      <span className="small">Leave {info.title}? You will stop getting its messages.</span>
                      <button
                        type="button"
                        className="button danger"
                        disabled={busy}
                        onClick={() => void change({ action: 'leave' }, 'You left the group').then((ok) => ok && setOpen(false))}
                      >
                        Leave
                      </button>
                      <button type="button" className="button" onClick={() => setConfirmLeave(false)}>
                        Stay
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

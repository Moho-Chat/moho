import { useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Asking } from './AccountList'
import { Modal } from './Modal'
import { ChoiceSetting } from './settings/controls'
import { ask } from '../lib/ask'
import { useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/** What the daemon says about a Telegram group or channel. */
interface Info {
  title: string
  about: string
  broadcast: boolean
  supergroup: boolean
  username?: string | null
  memberCount?: number | null
  isAdmin: boolean
  isCreator: boolean
  mayEdit: boolean
  mayInvite: boolean
  mayBan: boolean
  link?: string | null
  autoDelete: number
  slowMode: number
  membersMaySend: boolean
}

interface Person {
  userId: string
  nick: string
}

/** The periods Telegram's own apps offer, in seconds. */
const AUTO_DELETE = [
  { value: '0', label: 'Off' },
  { value: '86400', label: 'After a day' },
  { value: '604800', label: 'After a week' },
  { value: '2678400', label: 'After a month' }
]

const SLOW_MODE = [
  { value: '0', label: 'Off' },
  { value: '10', label: '10 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '300', label: '5 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '3600', label: '1 hour' }
]

/**
 * A Telegram group or channel's settings: its name, description and picture, its invite link, adding people, how long
 * messages last, slow mode, whether members may write, and the people banned from it. Shown to everybody, offered to
 * administrators: a member can still read what the rules are.
 *
 * Read when opened and again after each change, because Telegram is the one that says what is true.
 */
export function TelegramChatSettings({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Info | null>(null)
  const [banned, setBanned] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [about, setAbout] = useState('')
  const [adding, setAdding] = useState('')

  const load = async (): Promise<void> => {
    try {
      const got = await ask<Info>('telegramChatInfo', { bufferId: buffer.id })
      setInfo(got)
      setTitle(got.title)
      setAbout(got.about)
      setBanned(got.mayBan ? await ask<Person[]>('telegramBanned', { bufferId: buffer.id }) : [])
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
    void load()
  }

  /** One change, then the settings as they are after it. */
  const change = async (params: Record<string, unknown>, done?: string): Promise<boolean> => {
    setBusy(true)
    try {
      const r = await ask<{ note?: string | null }>('telegramChatChange', { bufferId: buffer.id, ...params })
      if (r.note) store.toast('info', r.note)
      else if (done) store.toast('info', done)
      await load()
      return true
    } catch (e) {
      store.toast('error', `Couldn't change that: ${(e as Error).message}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const unban = async (p: Person): Promise<void> => {
    setBusy(true)
    try {
      await ask('moderateTelegramMember', { bufferId: buffer.id, userId: p.userId, action: 'unban' })
      store.toast('info', `${p.nick} is no longer banned`)
      await load()
    } catch (e) {
      store.toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const what = info?.broadcast ? 'channel' : 'group'
  const edit = !!info?.mayEdit

  return (
    <>
      <span className="header-anchor">
        <IconButton name="tune" title="Chat settings" className={open ? 'active' : undefined} onClick={show} />
      </span>
      {open && (
        <Modal title={info?.broadcast ? 'Channel settings' : 'Group settings'} icon="tune" className="room-settings" onClose={() => setOpen(false)}>
          <div className="room-settings-body">
            {!info && <Asking what="Telegram" />}
            {info && (
              <>
                <section className="page-section">
                  <h4 className="section-label">About</h4>
                  <div className="card card-fields">
                    <label className="field">
                      <span className="field-label">Name</span>
                      <div className="action-field">
                        <input className="text-field" value={title} maxLength={128} disabled={!edit || busy} onChange={(e) => setTitle(e.target.value)} />
                        <button type="button" className="button primary" disabled={!edit || busy || !title.trim() || title === info.title} onClick={() => void change({ action: 'rename', title }, `The ${what} was renamed`)}>
                          Save
                        </button>
                      </div>
                    </label>
                    <label className="field">
                      <span className="field-label">Description</span>
                      <div className="action-field">
                        <input className="text-field" value={about} maxLength={255} placeholder="What it is about" disabled={!edit || busy} onChange={(e) => setAbout(e.target.value)} />
                        <button type="button" className="button primary" disabled={!edit || busy || about === info.about} onClick={() => void change({ action: 'describe', about })}>
                          Save
                        </button>
                      </div>
                    </label>
                    <div className="setting-row">
                      <div className="setting-text">
                        <div>Picture</div>
                        <div className="small muted">{edit ? 'A JPEG, PNG or WebP.' : 'Only an administrator can change these.'}</div>
                      </div>
                      <button
                        type="button"
                        className="button quiet"
                        disabled={!edit || busy}
                        onClick={() =>
                          void window.moho.pickFile(['jpg', 'jpeg', 'png', 'webp']).then((path) => {
                            if (path) void change({ action: 'picture', path }, `The ${what} has a new picture`)
                          })
                        }
                      >
                        {buffer.avatarUrl ? 'Change picture…' : 'Choose a picture…'}
                      </button>
                      {buffer.avatarUrl && (
                        <button type="button" className="button quiet" disabled={!edit || busy} onClick={() => void change({ action: 'picture', path: '' }, 'The picture was taken away')}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                <section className="page-section">
                  <h4 className="section-label">{info.broadcast ? 'Subscribers' : 'Members'}</h4>
                  <div className="card card-fields">
                    <div className="field">
                      <span className="field-label">{info.username ? `Invite link · public as t.me/${info.username}` : 'Invite link'}</span>
                      {info.link ? (
                        <div className="action-field">
                          <input className="text-field" readOnly value={info.link} onFocus={(e) => e.target.select()} />
                          <button type="button" className="button quiet" onClick={() => void navigator.clipboard.writeText(info.link ?? '').then(() => store.toast('info', 'Link copied'))}>
                            <Icon name="content_copy" size={16} /> Copy
                          </button>
                          {info.isAdmin && (
                            <button type="button" className="button quiet" disabled={busy} onClick={() => void change({ action: 'resetLink' }, 'The old link no longer works')}>
                              Reset
                            </button>
                          )}
                        </div>
                      ) : info.isAdmin ? (
                        <div className="tool-actions">
                          <button type="button" className="button quiet" disabled={busy} onClick={() => void change({ action: 'resetLink' }, 'There is a link now')}>
                            <Icon name="link" size={16} /> Make a link
                          </button>
                        </div>
                      ) : (
                        <span className="small muted">Only an administrator can see or make the link.</span>
                      )}
                    </div>
                    {info.mayInvite && (
                      <label className="field">
                        <span className="field-label">{info.broadcast ? 'Add subscribers' : 'Add people'}</span>
                        <div className="action-field">
                          <input
                            className="text-field"
                            placeholder="@names, separated by commas"
                            value={adding}
                            disabled={busy}
                            onChange={(e) => setAdding(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && adding.trim() && void change({ action: 'add', names: adding }, 'Added').then((ok) => ok && setAdding(''))}
                          />
                          <button type="button" className="button primary" disabled={busy || !adding.trim()} onClick={() => void change({ action: 'add', names: adding }, 'Added').then((ok) => ok && setAdding(''))}>
                            Add
                          </button>
                        </div>
                      </label>
                    )}
                  </div>
                </section>

                <section className="page-section">
                  <h4 className="section-label">Messages</h4>
                  <div className="card card-fields">
                    <ChoiceSetting
                      label="Delete messages automatically"
                      description={info.isAdmin || !info.supergroup ? 'New messages are deleted for everybody this long after they are sent.' : 'Only an administrator can change this.'}
                      value={String(info.autoDelete)}
                      options={AUTO_DELETE.some((o) => o.value === String(info.autoDelete)) ? AUTO_DELETE : [...AUTO_DELETE, { value: String(info.autoDelete), label: `${info.autoDelete} seconds` }]}
                      disabled={busy || (!info.isAdmin && info.supergroup)}
                      onChange={(v) => void change({ action: 'autoDelete', seconds: Number(v) })}
                    />
                    {info.supergroup && !info.broadcast && (
                      <>
                        <ChoiceSetting
                          label="Slow mode"
                          description="How long each member waits between messages. Administrators do not wait."
                          value={String(info.slowMode)}
                          options={SLOW_MODE}
                          disabled={busy || !info.isAdmin}
                          onChange={(v) => void change({ action: 'slowMode', seconds: Number(v) })}
                        />
                        <div className="setting-row">
                          <div className="setting-text">
                            <div>Who can send messages</div>
                            <div className="small muted">Administrators always can.</div>
                          </div>
                          <div className="segmented" role="radiogroup" aria-label="Who can send messages">
                            {(['all', 'admins'] as const).map((who) => (
                              <button
                                key={who}
                                type="button"
                                role="radio"
                                aria-checked={(info.membersMaySend ? 'all' : 'admins') === who}
                                className={(info.membersMaySend ? 'all' : 'admins') === who ? 'active' : undefined}
                                disabled={busy || !edit}
                                onClick={() => void change({ action: 'membersMaySend', may: who === 'all' })}
                              >
                                {who === 'all' ? 'Everybody' : 'Administrators'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {banned.length > 0 && (
                  <section className="page-section">
                    <h4 className="section-label">Banned</h4>
                    <div className="card tool-list">
                      {banned.map((p) => (
                        <div key={p.userId} className="setting-row">
                          <Icon name="block" size={18} />
                          <div className="setting-text">
                            <div className="ellipsis">{p.nick}</div>
                            <div className="small muted">Cannot join again until the ban is lifted</div>
                          </div>
                          <button type="button" className="button quiet" disabled={busy} onClick={() => void unban(p)}>
                            Lift ban
                          </button>
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

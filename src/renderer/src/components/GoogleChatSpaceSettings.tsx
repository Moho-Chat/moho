import { useState } from 'react'
import { IconButton } from './Icon'
import { Asking } from './AccountList'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/** A conversation's settings as the daemon reads them from Google (backend/googlechat/space_settings.rs). */
interface Settings {
  isSpace: boolean
  name: string
  emoji: string
  description: string
  guidelines: string
  historyOn: boolean
  manager: boolean
}

type Field = 'emoji' | 'name' | 'description' | 'guidelines'

/**
 * A Google Chat conversation's settings, from its header: a space's emoji, name, description and guidelines, and -
 * in a space or a direct message alike - whether history is on. With history off Google deletes new messages after a
 * day, and moho deletes them from its own scrollback at the same time.
 *
 * Access level and the permission settings (who may post, add people, use @all) are Google Workspace's: a personal
 * Google account's spaces have none, so they are not offered.
 */
export function GoogleChatSpaceSettings({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Settings | null>(null)
  const [form, setForm] = useState<Record<Field, string>>({ emoji: '', name: '', description: '', guidelines: '' })
  const [historyOn, setHistoryOn] = useState(true)
  const [busy, setBusy] = useState(false)

  const call = <T,>(action: string, params: Record<string, unknown> = {}): Promise<T> =>
    window.moho.rpc<T>('googlechat', { action, bufferId: buffer.id, ...params })

  const load = (): void => {
    void call<Settings>('spaceSettings')
      .then((s) => {
        setInfo(s)
        setForm({ emoji: s.emoji, name: s.name, description: s.description, guidelines: s.guidelines })
        setHistoryOn(s.historyOn)
      })
      .catch((e: Error) => {
        store.toast('error', e.message)
        setOpen(false)
      })
  }

  const fields: Field[] = info?.isSpace ? ['emoji', 'name', 'description', 'guidelines'] : []
  const changed = fields.filter((k) => info && form[k] !== info[k])
  const historyChanged = !!info && historyOn !== info.historyOn
  const save = (): void => {
    if (!info) return
    setBusy(true)
    const params: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, form[k]]))
    if (historyChanged) params.historyOn = historyOn
    void call<{ bufferId: string }>('saveSpaceSettings', params)
      .then(() => {
        store.toast('info', info.isSpace ? 'Space settings saved' : 'Conversation settings saved')
        setOpen(false)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const words: Record<Field, string> = { emoji: 'Emoji', name: 'Name', description: 'Description', guidelines: 'Guidelines' }
  const limits: Record<Field, number> = { emoji: 16, name: 128, description: 4096, guidelines: 5000 }

  return (
    <>
      <span className="header-anchor">
        <IconButton
          name="tune"
          title={buffer.kind === 'dm' ? 'Conversation settings' : 'Space settings'}
          className={open ? 'active' : undefined}
          onClick={() => {
            if (open) setOpen(false)
            else {
              setOpen(true)
              setInfo(null)
              load()
            }
          }}
        />
      </span>
      {open && (
        <Modal
          title={info?.isSpace ? `${info.emoji ? `${info.emoji} ` : ''}${info.name || 'Space settings'}` : 'Conversation settings'}
          icon="tune"
          className="room-settings"
          onClose={() => setOpen(false)}
        >
          <div className="room-settings-body">
            {!info && <Asking what="Google Chat" />}
            {info && (
              <section className="page-section">
                <div className="card card-fields">
                  {fields.map((k) => (
                    <label key={k} className="field">
                      <span className="field-label">{words[k]}</span>
                      {k === 'description' || k === 'guidelines' ? (
                        <textarea
                          className="text-field"
                          rows={k === 'guidelines' ? 4 : 3}
                          maxLength={limits[k]}
                          value={form[k]}
                          disabled={busy}
                          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                        />
                      ) : (
                        <input
                          className="text-field"
                          maxLength={limits[k]}
                          value={form[k]}
                          placeholder={k === 'emoji' ? 'One emoji, e.g. 🚀' : undefined}
                          disabled={busy}
                          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                        />
                      )}
                    </label>
                  ))}
                  <div className="switch-row">
                    <div className="switch-text">
                      <span>History is {historyOn ? 'on' : 'off'}</span>
                      <span className="small muted">
                        {historyOn
                          ? 'Messages are kept.'
                          : 'New messages are deleted after 24 hours, for everybody - and from moho too. What was already said is kept.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={historyOn}
                      aria-label="History"
                      className={historyOn ? 'switch on' : 'switch'}
                      disabled={busy}
                      onClick={() => setHistoryOn(!historyOn)}
                    >
                      <span className="switch-knob" />
                    </button>
                  </div>
                  <div className="field-row">
                    <button type="button" className="button primary" disabled={busy || (changed.length === 0 && !historyChanged)} onClick={save}>
                      Save
                    </button>
                  </div>
                  {info.isSpace && !info.manager && (
                    <div className="small muted">You do not manage this space, so Google may not accept changes to it.</div>
                  )}
                </div>
              </section>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

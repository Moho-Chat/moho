import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { XmppDataForm, type XmppForm } from './XmppDataForm'
import { useStore } from '../state/hooks'

/**
 * A room's own controls: its settings (a form the room provides, for its owner), who holds which standing in it, an
 * invitation, and the subject. What a person may not do is refused by the room in words, and those words are shown.
 */
export function XmppRoomDialog({ bufferId, name, onClose }: { bufferId: string; name: string; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [tab, setTab] = useState<'settings' | 'people' | 'invite'>('people')
  const [form, setForm] = useState<XmppForm | null>(null)
  const [formError, setFormError] = useState('')
  const [standing, setStanding] = useState<'owner' | 'admin' | 'member' | 'outcast'>('member')
  const [people, setPeople] = useState<{ jid: string; reason: string }[]>([])
  const [peopleError, setPeopleError] = useState('')
  const [who, setWho] = useState('')
  const [reason, setReason] = useState('')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const say = (e: Error): void => store.toast('error', e.message)

  useEffect(() => {
    if (tab !== 'settings') return
    setForm(null)
    setFormError('')
    void window.moho
      .rpc<XmppForm>('xmppRoomConfig', { bufferId })
      .then(setForm)
      .catch((e: Error) => setFormError(e.message))
  }, [tab, bufferId])

  const loadPeople = (): void => {
    setPeopleError('')
    void window.moho
      .rpc<{ people: { jid: string; reason: string }[] }>('xmppAffiliations', { bufferId, affiliation: standing })
      .then((r) => setPeople(r.people))
      .catch((e: Error) => {
        setPeople([])
        setPeopleError(e.message)
      })
  }
  useEffect(() => {
    if (tab === 'people') loadPeople()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, standing, bufferId])

  const act = (action: string, jid: string): void => {
    setBusy(true)
    void window.moho
      .rpc('xmppRoomAction', { bufferId, action, jid, reason })
      .then(() => {
        setWho('')
        loadPeople()
      })
      .catch(say)
      .finally(() => setBusy(false))
  }

  return (
    <Modal title={`${name} — room`} icon="forum" onClose={onClose} className="xmpp-room-dialog">
      <div className="segmented">
        {(['people', 'settings', 'invite'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : undefined} onClick={() => setTab(t)}>
            {t === 'people' ? 'People' : t === 'settings' ? 'Settings' : 'Invite & subject'}
          </button>
        ))}
      </div>
      {tab === 'settings' && (
        <div className="field-row">
          <span className="small muted">The room&apos;s picture (XEP-0486)</span>
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() =>
              void window.moho.pickFile().then((path) => {
                if (path) void window.moho.rpc('xmppSetRoomAvatar', { bufferId, path }).then(() => store.toast('info', 'Room picture changed')).catch(say)
              })
            }
          >
            Choose a picture…
          </button>
          <button type="button" className="button subtle small" disabled={busy} onClick={() => void window.moho.rpc('xmppSetRoomAvatar', { bufferId, path: '' }).then(() => store.toast('info', 'Room picture taken off')).catch(say)}>
            Take it off
          </button>
        </div>
      )}
      {tab === 'settings' &&
        (form ? (
          <XmppDataForm
            form={form}
            submitLabel="Save settings"
            busy={busy}
            onSubmit={(answers) => {
              setBusy(true)
              void window.moho
                .rpc('xmppSetRoomConfig', { bufferId, answers })
                .then(() => store.toast('info', 'Room settings saved'))
                .catch(say)
                .finally(() => setBusy(false))
            }}
          />
        ) : (
          <p className="small muted">{formError || 'Asking the room…'}</p>
        ))}
      {tab === 'people' && (
        <div className="add-form">
          <div className="segmented">
            {(['owner', 'admin', 'member', 'outcast'] as const).map((s) => (
              <button key={s} type="button" className={standing === s ? 'active' : undefined} onClick={() => setStanding(s)}>
                {s === 'outcast' ? 'Banned' : s === 'owner' ? 'Owners' : s === 'admin' ? 'Admins' : 'Members'}
              </button>
            ))}
          </div>
          {peopleError && <p className="small muted">{peopleError}</p>}
          <ul className="plain-list">
            {people.map((p) => (
              <li key={p.jid} className="field-row">
                <span className="ellipsis">{p.jid}</span>
                {p.reason && <span className="small muted ellipsis">{p.reason}</span>}
                <button type="button" className="button small" disabled={busy} onClick={() => act('unmember', p.jid)}>
                  Remove
                </button>
              </li>
            ))}
            {people.length === 0 && !peopleError && <li className="small muted">Nobody</li>}
          </ul>
          <div className="field-row">
            <input className="text-field" placeholder="Address, like friend@example.org" value={who} onChange={(e) => setWho(e.target.value)} />
            <input className="text-field" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="button" disabled={busy || !who.trim()} onClick={() => act(standing === 'outcast' ? 'ban' : standing, who.trim())}>
              {standing === 'outcast' ? 'Ban' : 'Add'}
            </button>
          </div>
        </div>
      )}
      {tab === 'invite' && (
        <div className="add-form">
          <div className="field-row">
            <input className="text-field" placeholder="Invite: friend@example.org" value={who} onChange={(e) => setWho(e.target.value)} />
            <button
              type="button"
              className="button"
              disabled={busy || !who.trim()}
              onClick={() => {
                void window.moho
                  .rpc('xmppInvite', { bufferId, jid: who.trim(), reason })
                  .then(() => {
                    store.toast('info', `Invited ${who.trim()}`)
                    setWho('')
                  })
                  .catch(say)
              }}
            >
              Invite
            </button>
          </div>
          <div className="field-row">
            <input className="text-field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void window.moho.rpc('xmppSetSubject', { bufferId, subject }).then(() => store.toast('info', 'Subject set')).catch(say)}
            >
              Set subject
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

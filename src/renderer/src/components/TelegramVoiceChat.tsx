import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Modal } from './Modal'
import { Asking } from './AccountList'
import { classes } from '../lib/util'
import { ask } from '../lib/ask'
import { useChat, useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'
import type { TelegramVoiceParticipant } from '../lib/telegramvoice'

interface Info {
  active: boolean
  call?: string
  title?: string
  count?: number
  participants?: TelegramVoiceParticipant[]
}

/**
 * A Telegram group's or channel's voice chat, from the conversation's header: who is in it, joining and leaving,
 * starting one and ending it. The microphone and deafen buttons in the footer work on it as on every other call.
 *
 * Starting and ending are an administrator's, and muting somebody else too; they are offered to everybody, and
 * Telegram's refusal is said in words, as the other moderation in moho is.
 */
export function TelegramVoiceChat({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const now = useChat((s) => s.telegramVoiceNow)
  const live = useChat((s) => s.telegramVoiceCalls[buffer.id])
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const here = now?.bufferId === buffer.id

  const load = async (): Promise<void> => {
    try {
      setInfo(await ask<Info>('telegramVoice', { op: 'info', bufferId: buffer.id }))
    } catch (e) {
      setInfo({ active: false })
      store.toast('error', (e as Error).message)
    }
  }
  // Read once when the conversation is opened, so the button can say whether a voice chat is going.
  useEffect(() => {
    setInfo(null)
    void ask<Info>('telegramVoice', { op: 'info', bufferId: buffer.id })
      .then(setInfo)
      .catch(() => setInfo({ active: false }))
  }, [buffer.id, live])

  const act = async (op: string, done?: string): Promise<void> => {
    setBusy(true)
    try {
      await ask('telegramVoice', { op, bufferId: buffer.id, call: info?.call ?? '' })
      if (done) store.toast('info', done)
      await load()
    } catch (e) {
      store.toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const going = here || !!info?.active
  const people = here ? (now?.people ?? []) : (info?.participants ?? []).filter((p) => !p.left)
  const speaking = new Set(here ? now?.speakers : [])

  return (
    <>
      <span className="header-anchor">
        <IconButton
          name={here ? 'graphic_eq' : 'record_voice_over'}
          title={here ? 'In the voice chat' : going ? `Voice chat going${info?.count ? `: ${info.count} in it` : ''}` : 'Voice chat'}
          className={open || here ? 'active' : undefined}
          color={going && !here ? 'var(--success)' : undefined}
          onClick={() => {
            setOpen(!open)
            if (!open) void load()
          }}
        />
      </span>
      {open && (
        <Modal title={info?.title || 'Voice chat'} icon="record_voice_over" className="room-settings" onClose={() => setOpen(false)}>
          <div className="room-settings-body">
            {!info && !here && <Asking what="Telegram" />}
            {info && !going && (
              <div className="card">
                <div className="setting-row">
                  <Icon name="mic_none" size={18} />
                  <div className="setting-text">
                    <div>No voice chat here now</div>
                    <div className="small muted">Starting one is an administrator&rsquo;s; everybody here is told it began.</div>
                  </div>
                  <button type="button" className="button primary" disabled={busy} onClick={() => void act('start', 'The voice chat started')}>
                    <Icon name="mic" size={16} /> Start
                  </button>
                </div>
              </div>
            )}
            {going && (
              <>
                {here && (now?.phase === 'connecting' || now?.forcedMute) && (
                  <div className={classes('page-banner', now?.forcedMute ? 'tone-off' : 'tone-busy')} role="status">
                    <Icon name={now?.forcedMute ? 'mic_off' : 'hourglass_top'} size={20} />
                    <div className="page-banner-text">
                      <div className="page-banner-title">{now?.forcedMute ? 'An administrator muted you' : 'Connecting…'}</div>
                      {now?.forcedMute && <div className="page-banner-detail">They can let you speak again.</div>}
                    </div>
                  </div>
                )}
                <section className="page-section">
                  <h4 className="section-label">In the voice chat · {here ? people.length : (info?.count ?? people.length)}</h4>
                  <div className="card tool-list">
                    {people.length === 0 && <p className="small muted tool-none">Nobody yet.</p>}
                    {people.map((p) => (
                      <div key={p.id} className="setting-row">
                        <Icon name={speaking.has(p.id) ? 'graphic_eq' : p.muted ? 'mic_off' : 'mic'} size={18} color={speaking.has(p.id) ? 'var(--success)' : undefined} />
                        <div className="setting-text">
                          <div className="ellipsis">
                            {p.name || 'Somebody'}
                            {p.self ? ' (you)' : ''}
                          </div>
                          <div className="small muted">{p.raisedHand ? 'Wants to speak' : speaking.has(p.id) ? 'Speaking' : p.muted ? 'Muted' : 'Listening'}</div>
                        </div>
                        {here && !p.self && (
                          <button type="button" className="button quiet" onClick={() => void store.muteInTelegramVoice(p.id, !p.muted)}>
                            {p.muted ? 'Let speak' : 'Mute'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <div className="reason-prompt-actions">
                  <button type="button" className="button subtle" disabled={busy} onClick={() => void act('end', 'The voice chat ended for everyone').then(() => (here ? store.leaveVoice(buffer.accountId) : undefined))}>
                    End for everyone
                  </button>
                  {here ? (
                    <button type="button" className="button danger" onClick={() => void store.leaveVoice(buffer.accountId)}>
                      <Icon name="call_end" size={16} /> Leave
                    </button>
                  ) : (
                    <button type="button" className="button primary" disabled={busy || !!now} title={now ? 'You are in another voice chat' : undefined} onClick={() => void store.joinTelegramVoice(buffer.id)}>
                      <Icon name="call" size={16} /> Join
                    </button>
                  )}
                </div>
                <p className="small muted">The microphone and deafen buttons in the footer work here too.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

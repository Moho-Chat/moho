import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Modal } from './Modal'
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
            {!info && !here && <div className="small muted">Looking…</div>}
            {info && !going && (
              <>
                <p className="small muted">There is no voice chat here now.</p>
                <div className="field-row">
                  <button type="button" className="button primary" disabled={busy} onClick={() => void act('start', 'The voice chat started')}>
                    Start a voice chat
                  </button>
                </div>
              </>
            )}
            {going && (
              <>
                {here && now?.phase === 'connecting' && <p className="small muted">Connecting…</p>}
                {here && now?.forcedMute && <p className="small muted">An administrator muted you. They can let you speak again.</p>}
                <div className="field">
                  <span className="small muted">In the voice chat ({here ? people.length : (info?.count ?? people.length)})</span>
                  {people.map((p) => (
                    <div key={p.id} className="field-row">
                      <Icon name={speaking.has(p.id) ? 'graphic_eq' : p.muted ? 'mic_off' : 'mic'} size={16} color={speaking.has(p.id) ? 'var(--success)' : undefined} />
                      <span className="grow ellipsis">
                        {p.name || 'Somebody'}
                        {p.self ? ' (you)' : ''}
                        {p.raisedHand ? ' ✋' : ''}
                      </span>
                      {here && !p.self && (
                        <button type="button" className="button subtle small" onClick={() => void store.muteInTelegramVoice(p.id, !p.muted)}>
                          {p.muted ? 'Let speak' : 'Mute'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="field-row">
                  {here ? (
                    <button type="button" className="button danger" onClick={() => void store.leaveVoice(buffer.accountId)}>
                      Leave
                    </button>
                  ) : (
                    <button type="button" className="button primary" disabled={busy || !!now} title={now ? 'You are in another voice chat' : undefined} onClick={() => void store.joinTelegramVoice(buffer.id)}>
                      Join
                    </button>
                  )}
                  <button type="button" className="button subtle" disabled={busy} onClick={() => void act('end', 'The voice chat ended for everyone').then(() => (here ? store.leaveVoice(buffer.accountId) : undefined))}>
                    End for everyone
                  </button>
                </div>
                <p className="small muted">Your microphone and the deafen button in the footer work here too.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

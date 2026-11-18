import { useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Asking } from './AccountList'
import { Modal } from './Modal'
import { ChoiceSetting } from './settings/controls'
import { ask } from '../lib/ask'
import { useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

interface Info {
  ready: boolean
  timer: number
  /** The safety key both people compare, as hex. */
  fingerprint: string
  layer: number
}

/** The self-destruct times Telegram's own apps offer, in seconds. */
const TIMERS = [
  { value: '0', label: 'Off' },
  { value: '1', label: '1 second' },
  { value: '5', label: '5 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '1 week' }
]

/**
 * Telegram's secret chats in the conversation header.
 *
 * In an ordinary conversation with a person: a lock that asks them for a secret chat. In a secret chat: its settings,
 * which are the self-destruct timer and the safety key - the same rows of numbers the other person's app shows, so
 * the two can be compared face to face or on a call.
 */
export function TelegramSecretTools({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const secret = buffer.remoteId?.startsWith('secret:') ?? false

  if (!secret) {
    // A person, named by their number; a bot cannot have one.
    if (!buffer.remoteId || !/^\d+$/.test(buffer.remoteId) || buffer.nameIcon === 'smart_toy') return null
    return (
      <span className="header-anchor">
        <IconButton name="lock" title="Start a secret chat" onClick={() => void store.startTelegramSecretChat(buffer.accountId, buffer.remoteId ?? '')} />
      </span>
    )
  }

  const load = async (): Promise<void> => {
    try {
      setInfo(await ask<Info>('telegramSecretInfo', { bufferId: buffer.id }))
    } catch (e) {
      store.toast('error', (e as Error).message)
      setOpen(false)
    }
  }
  const setTimer = async (seconds: number): Promise<void> => {
    setBusy(true)
    try {
      await ask('setTelegramSecretTimer', { bufferId: buffer.id, seconds })
      await load()
    } catch (e) {
      store.toast('error', `Couldn't change that: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  // Four groups of four hex digits a row, as Telegram's apps print the key.
  const rows = (info?.fingerprint.match(/.{1,16}/g) ?? []).map((row) => row.match(/.{1,4}/g)?.join(' ') ?? row)

  return (
    <>
      <span className="header-anchor">
        <IconButton
          name="lock"
          title="Secret chat settings"
          className={open ? 'active' : undefined}
          onClick={() => {
            setOpen(!open)
            if (!open) {
              setInfo(null)
              void load()
            }
          }}
        />
      </span>
      {open && (
        <Modal title="Secret chat" icon="lock" className="room-settings" onClose={() => setOpen(false)}>
          <div className="room-settings-body">
            {!info && <Asking what="Telegram" />}
            {info && (
              <>
                <p className="small muted">
                  Encrypted end to end and kept only on this device: Telegram&rsquo;s servers carry it without being able to read it, and your other
                  devices do not have it.
                </p>
                {!info.ready && (
                  <div className="page-banner tone-busy" role="status">
                    <Icon name="hourglass_top" size={20} />
                    <div className="page-banner-text">
                      <div className="page-banner-title">Waiting for them to accept</div>
                    </div>
                  </div>
                )}
                <section className="page-section">
                  <h4 className="section-label">Messages</h4>
                  <div className="card card-fields">
                    <ChoiceSetting
                      label="Self-destruct timer"
                      description="New messages disappear this long after they are read, on both sides."
                      value={String(info.timer)}
                      options={TIMERS.some((t) => t.value === String(info.timer)) ? TIMERS : [...TIMERS, { value: String(info.timer), label: `${info.timer} seconds` }]}
                      disabled={busy || !info.ready}
                      onChange={(v) => void setTimer(Number(v))}
                    />
                  </div>
                </section>
                {info.fingerprint && (
                  <section className="page-section">
                    <h4 className="section-label">Encryption key</h4>
                    <div className="card card-fields">
                      <pre className="secret-key selectable">{rows.join('\n')}</pre>
                      <span className="small muted">Compare it with the one in their app. If it is the same, nobody is in the middle.</span>
                    </div>
                  </section>
                )}
                <p className="small muted">Closing this conversation ends the secret chat for both of you.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

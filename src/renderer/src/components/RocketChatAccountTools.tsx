import { useEffect, useState } from 'react'
import { SwitchRow } from './Switch'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

interface RocketChatSettingsState {
  accountId: string
  serverUrl: string
  username: string
  userId: string
  defaultStatus: string
  omnichannelEnabled: boolean
  isLivechatAgent: boolean
  hasE2eePassphrase: boolean
  e2eeUnlocked: boolean
  useTor: boolean
  server?: {
    site_name?: string
    version?: { raw?: string }
    e2ee_enabled?: boolean
    federation_enabled?: boolean
    read_receipts_enabled?: boolean
    webrtc_enabled?: boolean
    livechat_enabled?: boolean
    max_upload_bytes?: number
  } | null
}

/**
 * Rocket.Chat account settings page (Round 5 & Round 9):
 * - Server URL & discovered capabilities
 * - E2EE passphrase unlock / reset (with clear warning & E2EE search notice)
 * - Default status (`online`, `away`, `busy`, `offline`)
 * - Omnichannel / Livechat toggle (for `livechat-agent` accounts)
 * - Log out other active sessions
 */
export function RocketChatAccountTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [info, setInfo] = useState<RocketChatSettingsState | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [rememberPass, setRememberPass] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const refresh = (): void => {
    void window.moho
      .rpc<RocketChatSettingsState>('rocketchatAccountSettings', { accountId: account.id })
      .then(setInfo)
      .catch(() => {})
  }

  useEffect(() => {
    refresh()
  }, [account.id, account.state])

  const unlockE2ee = async (): Promise<void> => {
    if (!passphrase.trim()) return
    setBusy(true)
    try {
      const res = await window.moho.rpc<{ unlocked: boolean; roomsUnlocked: number; generatedKeypair: boolean }>(
        'rocketchatE2eeUnlock',
        { accountId: account.id, passphrase, remember: rememberPass }
      )
      setPassphrase('')
      store.toast(
        'info',
        res.generatedKeypair
          ? `Generated E2EE keypair and unlocked ${res.roomsUnlocked} room(s).`
          : `E2EE unlocked (${res.roomsUnlocked} encrypted room(s)).`
      )
      refresh()
    } catch (e) {
      store.toast('error', String(e))
    } finally {
      setBusy(false)
    }
  }

  const resetE2ee = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.moho.rpc('rocketchatE2eeReset', { accountId: account.id })
      setConfirmReset(false)
      store.toast('info', 'Rocket.Chat E2EE key reset. Enter a new passphrase to generate a fresh keypair.')
      refresh()
    } catch (e) {
      store.toast('error', String(e))
    } finally {
      setBusy(false)
    }
  }

  const setDefaultStatus = async (defaultStatus: string): Promise<void> => {
    try {
      await window.moho.rpc('rocketchatUpdateAccountSettings', { accountId: account.id, defaultStatus })
      refresh()
      store.toast('info', `Default status set to ${defaultStatus}.`)
    } catch (e) {
      store.toast('error', String(e))
    }
  }

  const toggleOmnichannel = async (omnichannelEnabled: boolean): Promise<void> => {
    try {
      await window.moho.rpc('rocketchatUpdateAccountSettings', { accountId: account.id, omnichannelEnabled })
      refresh()
    } catch (e) {
      store.toast('error', String(e))
    }
  }

  const logoutOthers = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.moho.rpc('rocketchatLogoutOtherClients', { accountId: account.id })
      store.toast('info', 'Signed out all other Rocket.Chat sessions.')
    } catch (e) {
      store.toast('error', String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account-tools">
      {info && (
        <section className="settings-section">
          <h4>Server</h4>
          <p className="small muted">
            <strong>{info.server?.site_name || 'Rocket.Chat'}</strong> — {info.serverUrl}
            {info.server?.version?.raw ? ` (v${info.server.version.raw})` : ''}
          </p>
          <p className="small muted">
            Signed in as <code>@{info.username}</code>
            {info.server?.federation_enabled ? ' · Matrix Federation enabled' : ''}
            {info.server?.read_receipts_enabled ? ' · Read receipts enabled' : ''}
          </p>
        </section>
      )}

      <section className="settings-section">
        <h4>End-to-End Encryption (E2EE)</h4>
        <p className="small muted">
          Status:{' '}
          <strong>
            {info?.e2eeUnlocked
              ? 'Unlocked'
              : info?.hasE2eePassphrase
                ? 'Passphrase saved (unlocks on connect)'
                : 'Locked'}
          </strong>
        </p>
        <p className="small muted">
          Note: Rocket.Chat servers cannot index encrypted messages, so server-side search is unavailable in E2EE rooms;
          moho automatically falls back to local scrollback search.
        </p>
        <div className="field-row" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            type="password"
            placeholder="E2EE passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={busy}
          />
          <button type="button" onClick={() => void unlockE2ee()} disabled={busy || !passphrase.trim()}>
            Unlock E2EE
          </button>
        </div>
        <SwitchRow
          title="Remember passphrase locally (0600 storage)"
          checked={rememberPass}
          onChange={setRememberPass}
        />
        <div style={{ marginTop: 8 }}>
          {!confirmReset ? (
            <button type="button" className="danger" onClick={() => setConfirmReset(true)} disabled={busy}>
              Reset E2EE Key…
            </button>
          ) : (
            <div className="warning-box" style={{ marginTop: 6 }}>
              <p className="small">
                <strong>Warning:</strong> Resetting your Rocket.Chat E2EE key permanently discards your current RSA
                keypair. You will lose access to existing encrypted rooms until another member re-distributes the room
                key.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button type="button" className="danger" onClick={() => void resetE2ee()} disabled={busy}>
                  Confirm Reset E2EE Key
                </button>
                <button type="button" onClick={() => setConfirmReset(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h4>Presence &amp; Omnichannel</h4>
        <label className="field-label">
          <span className="small muted">Default status on connect</span>
          <select
            value={info?.defaultStatus || 'online'}
            onChange={(e) => void setDefaultStatus(e.target.value)}
          >
            <option value="online">Online</option>
            <option value="away">Away</option>
            <option value="busy">Busy</option>
            <option value="offline">Offline (Invisible)</option>
          </select>
        </label>
        <SwitchRow
          title="Omnichannel / Livechat rooms (requires livechat-agent role)"
          checked={Boolean(info?.omnichannelEnabled)}
          onChange={(v) => void toggleOmnichannel(v)}
        />
      </section>

      <section className="settings-section">
        <h4>Active Sessions</h4>
        <button type="button" onClick={() => void logoutOthers()} disabled={busy || account.state !== 'connected'}>
          Log out all other sessions
        </button>
      </section>
    </div>
  )
}

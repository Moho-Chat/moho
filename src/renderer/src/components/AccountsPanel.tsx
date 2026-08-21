import { useState } from 'react'
import { Icon, IconButton, MaskIcon } from './Icon'
import { MatrixAccountTools } from './MatrixAccountTools'
import { useChat, useStore } from '../state/hooks'
import { resolveMediaUrl, serviceIcon, serviceLabel } from '../lib/util'
import type { Account } from '../../../shared/wire'

const ADDABLE = ['irc', 'discord', 'sockchat', 'matrix'] as const
type AddableService = (typeof ADDABLE)[number]

export function AccountsPanel(): JSX.Element {
  const accounts = useChat((s) => s.accounts)
  const [adding, setAdding] = useState<AddableService | null>(accounts.length === 0 ? 'irc' : null)

  return (
    <div className="panel">
      <div className="panel-section">
        {accounts.length === 0 && (
          <p className="muted">
            No accounts yet. Pick a service below to connect one — nobilis keeps the connection alive
            in the background, so it survives closing this window.
          </p>
        )}
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </div>

      <div className="panel-section">
        <h3 className="panel-heading">Add an account</h3>
        <div className="service-picker">
          {ADDABLE.map((service) => {
            const icon = serviceIcon(service)
            return (
              <button
                key={service}
                type="button"
                className={`service-chip${adding === service ? ' active' : ''}`}
                onClick={() => setAdding(adding === service ? null : service)}
              >
                {icon.svg ? <MaskIcon src={icon.svg} size={16} /> : <Icon name={icon.glyph!} size={16} />}
                {serviceLabel(service)}
              </button>
            )
          })}
        </div>

        {adding === 'irc' && <IrcForm onDone={() => setAdding(null)} />}
        {adding === 'discord' && <DiscordForm />}
        {adding === 'sockchat' && <SockChatForm />}
        {adding === 'matrix' && <MatrixForm />}
      </div>
    </div>
  )
}

function AccountRow({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [expanded, setExpanded] = useState(false)
  const icon = serviceIcon(account.service)
  const connected = account.state === 'connected'

  const call = (method: string, params: Record<string, unknown>): void => {
    void window.moho
      .rpc(method, params)
      .then(() => store.refreshAccounts())
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="account-card">
      <div className="account-card-head">
        {account.avatarUrl ? (
          <img className="account-avatar" src={resolveMediaUrl(account.avatarUrl)} alt="" />
        ) : icon.svg ? (
          <MaskIcon src={icon.svg} size={20} />
        ) : (
          <Icon name={icon.glyph!} size={20} />
        )}
        <div className="account-card-title">
          <div className="ellipsis">{account.displayName || account.id}</div>
          <div className="small muted">
            {serviceLabel(account.service)} · {account.state}
          </div>
        </div>
        <button
          type="button"
          className="button subtle"
          onClick={() =>
            call('setAccountConnected', { accountId: account.id, connected: !connected })
          }
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
        <IconButton
          name={expanded ? 'expand_less' : 'expand_more'}
          title="Settings"
          onClick={() => setExpanded(!expanded)}
        />
      </div>

      {expanded && (
        <div className="account-card-body">
          <LabeledInput
            label="Display name"
            defaultValue={account.displayName}
            placeholder="Shown in the sidebar"
            onCommit={(name) => call('setAccountDisplayName', { accountId: account.id, name })}
          />

          {account.service === 'irc' && (
            <>
              <LabeledInput
                label="Autojoin channels"
                defaultValue={account.autojoin}
                placeholder="#one,#two"
                onCommit={(channels) =>
                  call('setAccountAutojoin', { accountId: account.id, channels })
                }
              />
              <LabeledInput
                label="NickServ password"
                type="password"
                placeholder={account.hasNickservPassword ? '(set)' : 'unset'}
                onCommit={(password) =>
                  call('setAccountNickservPassword', { accountId: account.id, password })
                }
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={account.useTor}
                  onChange={(e) =>
                    call('setAccountUseTor', {
                      accountId: account.id,
                      useTor: e.target.checked,
                      proxy: account.torProxy || '127.0.0.1:9050'
                    })
                  }
                />
                <span>
                  Route through a SOCKS5 proxy
                  <span className="small muted"> — an external Tor daemon or Tor Browser</span>
                </span>
              </label>
            </>
          )}

          {account.service === 'matrix' && <MatrixAccountTools account={account} />}

          <button
            type="button"
            className="button danger"
            onClick={() => {
              call('removeAccount', { accountId: account.id })
              void store.refreshBuffers()
            }}
          >
            <Icon name="delete" size={16} /> Remove account
          </button>
        </div>
      )}
    </div>
  )
}

function LabeledInput({
  label,
  defaultValue,
  placeholder,
  type,
  onCommit
}: {
  label: string
  defaultValue?: string
  placeholder?: string
  type?: string
  onCommit: (value: string) => void
}): JSX.Element {
  const [value, setValue] = useState(defaultValue ?? '')
  return (
    <label className="field">
      <span className="small muted">{label}</span>
      <input
        className="text-field"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== (defaultValue ?? '') && onCommit(value)}
        onKeyDown={(e) => e.key === 'Enter' && onCommit(value)}
      />
    </label>
  )
}

function IrcForm({ onDone }: { onDone: () => void }): JSX.Element {
  const store = useStore()
  const [nick, setNick] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('6697')
  const [ssl, setSsl] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!nick || !host) return
    setBusy(true)
    try {
      await window.moho.rpc('addAccount', { nick, host, port: Number(port) || undefined, ssl })
      await store.refreshAccounts()
      onDone()
    } catch (e) {
      store.toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="add-form">
      <div className="field-row">
        <label className="field">
          <span className="small muted">Nickname</span>
          <input className="text-field" value={nick} onChange={(e) => setNick(e.target.value)} />
        </label>
        <label className="field">
          <span className="small muted">Server</span>
          <input
            className="text-field"
            placeholder="irc.libera.chat"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="field port">
          <span className="small muted">Port</span>
          <input className="text-field" value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
        <span>Use TLS</span>
      </label>
      <button type="button" className="button" disabled={busy || !nick || !host} onClick={() => void submit()}>
        Connect
      </button>
    </div>
  )
}

/**
 * Discord's own cross-device QR login - the same flow discord.com/app offers.
 * Inherently multi-step and asynchronous: the RPC just kicks it off, and the
 * QR image plus the eventual result arrive as push events.
 */
function DiscordForm(): JSX.Element {
  const store = useStore()
  const qrPath = useChat((s) => s.discordQrPath)
  const status = useChat((s) => s.discordLoginStatus)

  return (
    <div className="add-form">
      <p className="small muted">
        Scan this code with the Discord mobile app (Settings → Scan QR Code), then approve the
        login on your phone.
      </p>
      {qrPath ? (
        <img className="qr-image" src={resolveMediaUrl(qrPath)} alt="Discord login QR code" />
      ) : (
        <button
          type="button"
          className="button"
          onClick={() =>
            void window.moho
              .rpc('addDiscordAccount')
              .then(() => store.setDiscordLoginStatus('Waiting for a code…'))
              .catch((e: Error) => store.toast('error', e.message))
          }
        >
          Start QR login
        </button>
      )}
      {status && <p className="small muted">{status}</p>}
    </div>
  )
}

/**
 * Sneedchat login runs over the embedded Tor client and may have to solve the
 * site's proof-of-work gate, so it can take anywhere from instant to over a
 * minute - hence the same async-kickoff shape as Discord's QR flow.
 */
function SockChatForm(): JSX.Element {
  const store = useStore()
  const status = useChat((s) => s.sockChatLoginStatus)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpSecret, setTotpSecret] = useState('')

  return (
    <div className="add-form">
      <div className="field-row">
        <label className="field">
          <span className="small muted">Username</span>
          <input className="text-field" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span className="small muted">Password</span>
          <input
            className="text-field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span className="small muted">TOTP secret (optional, if 2FA is on)</span>
        <input className="text-field" value={totpSecret} onChange={(e) => setTotpSecret(e.target.value)} />
      </label>
      <button
        type="button"
        className="button"
        disabled={!username || !password}
        onClick={() =>
          void window.moho
            .rpc('addSockChatAccount', {
              username,
              password,
              ...(totpSecret ? { totpSecret } : {})
            })
            .then(() => store.setSockChatLoginStatus('Bootstrapping Tor…'))
            .catch((e: Error) => store.toast('error', e.message))
        }
      >
        Connect
      </button>
      {status && <p className="small muted">{status}</p>}
    </div>
  )
}

function MatrixForm(): JSX.Element {
  const store = useStore()
  const status = useChat((s) => s.matrixLoginStatus)
  const [homeserverUrl, setHomeserverUrl] = useState('https://matrix.org')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="add-form">
      <label className="field">
        <span className="small muted">Homeserver</span>
        <input
          className="text-field"
          value={homeserverUrl}
          onChange={(e) => setHomeserverUrl(e.target.value)}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="small muted">Username</span>
          <input
            className="text-field"
            // Just the localpart. nobilis sends this as an m.id.user identifier,
            // which the homeserver resolves against itself, and the login
            // response hands back the full MXID - so there's nothing for the
            // user to type twice.
            placeholder="you"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="small muted">Password</span>
          <input
            className="text-field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="button"
        disabled={!userId || !password}
        onClick={() =>
          void window.moho
            .rpc('addMatrixAccount', {
              homeserverUrl,
              // Tolerate a pasted full MXID as well as a bare username: strip
              // the leading @ and anything from the first ':' onward.
              userId: userId.replace(/^@/, '').split(':')[0],
              password
            })
            .then(() => store.setMatrixLoginStatus('Logging in…'))
            .catch((e: Error) => store.toast('error', e.message))
        }
      >
        Log in
      </button>
      {status && <p className="small muted">{status}</p>}
      <p className="small muted">
        New sessions start unverified. Once logged in, verify this device from another signed-in
        session so encrypted history decrypts.
      </p>
    </div>
  )
}

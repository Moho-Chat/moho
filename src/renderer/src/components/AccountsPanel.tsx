import { useState } from 'react'
import { Icon, IconButton, MaskIcon } from './Icon'
import { MatrixAccountTools } from './MatrixAccountTools'
import { useChat, usePref, useStore } from '../state/hooks'
import { bufferDisplayName, resolveMediaUrl, serviceIcon, serviceLabel } from '../lib/util'
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
                {icon.mark ? <MaskIcon src={icon.mark} size={16} /> : <Icon name={icon.glyph!} size={16} />}
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

/**
 * Muted and hidden channels for one account, and the only way back from
 * either.
 *
 * Hiding a buffer removes its row, which also removes the context menu that
 * hid it - so without a list somewhere else, a hidden channel is gone for
 * good. Muting has the same problem one step removed: muting a server buffer
 * silences the whole account, and if that server buffer is *also* hidden there
 * is no row left holding the toggle that would undo it.
 */
function HiddenAndMuted({ accountId }: { accountId: string }): JSX.Element | null {
  const buffers = useChat((s) => s.buffers)
  const [muted, setMuted] = usePref<string[]>('mutedBuffers', [])
  const [hidden, setHidden] = usePref<string[]>('hiddenBuffers', [])

  const mine = buffers.filter(
    (b) => b.accountId === accountId && (muted.includes(b.id) || hidden.includes(b.id))
  )
  if (!mine.length) return null

  const drop = (list: string[], id: string): string[] => list.filter((x) => x !== id)

  return (
    <details className="recover-list">
      <summary className="small">
        Hidden and muted channels <span className="muted">({mine.length})</span>
      </summary>
      {mine.map((b) => {
        const isHidden = hidden.includes(b.id)
        const isMuted = muted.includes(b.id)
        return (
          <div key={b.id} className="recover-row">
            <span className="ellipsis recover-name" title={b.name}>
              {bufferDisplayName(b.name)}
            </span>
            <span className="small muted recover-state">
              {[isHidden && 'hidden', isMuted && 'muted'].filter(Boolean).join(' · ')}
            </span>
            {isHidden && (
              <button type="button" className="button subtle" onClick={() => setHidden(drop(hidden, b.id))}>
                Show
              </button>
            )}
            {isMuted && (
              <button type="button" className="button subtle" onClick={() => setMuted(drop(muted, b.id))}>
                Unmute
              </button>
            )}
          </div>
        )
      })}
    </details>
  )
}

/**
 * Per-server icon overrides for one account.
 *
 * Lives here rather than in Settings because the thing being renamed belongs
 * to an account - and because a rail tile is too small to hang an edit
 * affordance off without getting in the way of dragging it.
 *
 * Discord and Matrix supply icons of their own; this outranks them, and is the
 * only way to give an icon to something that has none - an IRC network, a
 * Sneedchat account, a guild whose owner never set one.
 */
function GroupIcons({ accountId }: { accountId: string }): JSX.Element | null {
  const store = useStore()
  const groups = useChat((s) => s.groups)
  const [icons, setIcons] = usePref<Record<string, string>>('groupIcons', {})

  const mine = groups.filter((g) => g.accountId === accountId)
  if (!mine.length) return null

  const choose = (groupId: string): void => {
    void window.moho.importGroupIcon(groupId).then((res) => {
      if (res.error) store.toast('error', res.error)
      // No path and no error means the picker was dismissed.
      else if (res.path) setIcons({ ...icons, [groupId]: res.path })
    })
  }

  const clear = (groupId: string): void => {
    const next = { ...icons }
    delete next[groupId]
    setIcons(next)
  }

  return (
    <div className="group-icons">
      <div className="small muted">Server icons</div>
      {mine.map((g) => {
        const custom = icons[g.id]
        const shown = custom || g.iconUrl
        return (
          <div key={g.id} className="group-icon-row">
            <span className="group-icon-preview">
              {shown ? (
                <img src={resolveMediaUrl(shown)} alt="" />
              ) : (
                <Icon name={g.kind === 'dms' ? 'forum' : 'tag'} size={16} />
              )}
            </span>
            <span className="ellipsis group-icon-name">{g.name}</span>
            <button type="button" className="button subtle" onClick={() => choose(g.id)}>
              {custom ? 'Replace' : 'Upload'}
            </button>
            {custom && (
              <button type="button" className="button subtle" onClick={() => clear(g.id)}>
                Reset
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AccountRow({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [expanded, setExpanded] = useState(false)
  const icon = serviceIcon(account.service)
  const connected = account.state === 'connected'
  /**
   * A connection attempt in progress is a third state, not a variety of
   * "disconnected".
   *
   * Treating it as one meant the button read Connect while an attempt was
   * already running, and pressing it started another - which leaves the state
   * exactly where it was, so a connection stuck retrying looked like a dead
   * button. What is wanted there is a way to stop.
   */
  const connecting = account.state === 'connecting'

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
        ) : icon.mark ? (
          <MaskIcon src={icon.mark} size={20} />
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
            call('setAccountConnected', {
              accountId: account.id,
              // Stopping covers both being connected and trying to be.
              connected: !connected && !connecting
            })
          }
        >
          {connected ? 'Disconnect' : connecting ? 'Cancel' : 'Connect'}
        </button>
        {connecting && (
          <button
            type="button"
            className="button subtle"
            // Starting over, for an attempt that is retrying without getting
            // anywhere: the daemon tears the old one down before starting.
            title="Stop this attempt and start again"
            onClick={() => {
              call('setAccountConnected', { accountId: account.id, connected: false })
              setTimeout(() => call('setAccountConnected', { accountId: account.id, connected: true }), 400)
            }}
          >
            Retry
          </button>
        )}
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

          <GroupIcons accountId={account.id} />
          <HiddenAndMuted accountId={account.id} />

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

          {account.service === 'discord' && <DiscordReauth account={account} />}

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
/**
 * Re-authentication for an existing Discord account, folded out in place.
 *
 * This is where it is actually needed: a revoked token shows up as the account
 * sitting at "auth_failed" in this list, so the fix belongs on the row that
 * reports the problem rather than in the add-an-account section, where it
 * would read as adding a second copy.
 */
function DiscordReauth({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const reauthing = useChat((s) => s.discordReauthAccountId) === account.id
  const revoked = account.state === 'auth_failed'

  if (!reauthing) {
    return (
      <div className="setting-row">
        <div className="setting-text">
          <div>Sign-in</div>
          <div className="small muted">
            {revoked
              ? 'Discord revoked this login. Re-authenticate to reconnect.'
              : 'Replace this account\u2019s login without removing it.'}
          </div>
        </div>
        <button
          type="button"
          className={revoked ? 'button' : 'button subtle'}
          onClick={() => store.setDiscordReauth(account.id)}
        >
          Re-authenticate
        </button>
      </div>
    )
  }

  return (
    <div className="matrix-tools">
      <DiscordForm accountId={account.id} />
      <button type="button" className="button subtle" onClick={() => store.setDiscordReauth('')}>
        Cancel
      </button>
    </div>
  )
}

/**
 * Discord sign-in, in either of the two ways Discord itself allows, plus the
 * two-factor step that either can land on.
 *
 * Doubles as the re-authentication form: when `accountId` is set the login is
 * bound to that existing account, so a revoked token is replaced rather than a
 * second copy of the account appearing beside the dead one.
 */
function DiscordForm({ accountId }: { accountId?: string }): JSX.Element {
  const store = useStore()
  const qrPath = useChat((s) => s.discordQrPath)
  const status = useChat((s) => s.discordLoginStatus)
  const mfa = useChat((s) => s.discordMfa)
  const [method, setMethod] = useState<'qr' | 'password'>('qr')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const target = accountId ? { accountId } : {}
  const fail = (e: Error): void => {
    store.toast('error', e.message)
    setBusy(false)
  }

  // The two-factor step replaces the form: the login is already in flight and
  // only needs the code to finish.
  if (mfa) {
    return (
      <div className="add-form">
        <p className="small muted">
          {mfa.totp
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Enter your verification code.'}
          {mfa.backup && ' A backup code works here too.'}
        </p>
        <div className="field-row">
          <input
            className="text-field"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.trim()) {
                void window.moho
                  .rpc('submitDiscordMfa', { loginId: mfa.loginId, code })
                  .catch(fail)
              }
            }}
          />
          <button
            type="button"
            className="button"
            disabled={!code.trim()}
            onClick={() =>
              void window.moho.rpc('submitDiscordMfa', { loginId: mfa.loginId, code }).catch(fail)
            }
          >
            Verify
          </button>
        </div>
        {/* When re-authenticating, the surrounding block already offers a
            Cancel that backs out of the whole thing - two stacked Cancels
            would just be a question of which one you meant. */}
        {!accountId && (
          <button
            type="button"
            className="button subtle"
            onClick={() => {
              store.clearDiscordMfa()
              setCode('')
            }}
          >
            Cancel
          </button>
        )}
        {status && <p className="small muted">{status}</p>}
      </div>
    )
  }

  return (
    <div className="add-form">
      <div className="setting-segmented">
        <button
          type="button"
          className={method === 'qr' ? 'active' : undefined}
          onClick={() => setMethod('qr')}
        >
          QR code
        </button>
        <button
          type="button"
          className={method === 'password' ? 'active' : undefined}
          onClick={() => setMethod('password')}
        >
          Password
        </button>
      </div>

      {method === 'qr' ? (
        <>
          <p className="small muted">
            Scan this with the Discord mobile app (Settings → Scan QR Code), then approve the login
            on your phone.
          </p>
          {qrPath ? (
            <img className="qr-image" src={resolveMediaUrl(qrPath)} alt="Discord login QR code" />
          ) : (
            <button
              type="button"
              className="button"
              onClick={() =>
                void window.moho
                  .rpc('addDiscordAccount', target)
                  .then(() => store.setDiscordLoginStatus('Waiting for a code…'))
                  .catch(fail)
              }
            >
              {accountId ? 'Re-authenticate with QR' : 'Start QR login'}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="field-row">
            <label className="field">
              <span className="small muted">Email or phone</span>
              <input
                className="text-field"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
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
            disabled={busy || !login || !password}
            onClick={() => {
              setBusy(true)
              void window.moho
                .rpc('addDiscordAccountPassword', { login, password, ...target })
                .then(() => {
                  setPassword('')
                  setBusy(false)
                })
                .catch(fail)
            }}
          >
            {accountId ? 'Re-authenticate' : 'Sign in'}
          </button>
          <p className="small muted">
            Discord often answers a password sign-in with a captcha, which can&apos;t be completed
            from here. QR login is the way through that, since approving on a device you are
            already signed in on is the same proof the captcha asks for.
          </p>
        </>
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

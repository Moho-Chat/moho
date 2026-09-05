import { useEffect, useState } from 'react'
import { Icon, IconButton, MaskIcon } from './Icon'
import { MatrixAccountTools } from './MatrixAccountTools'
import { useChat, useMapPref, usePref, useStore } from '../state/hooks'
import { bufferDisplayName, classes, resolveMediaUrl, serviceIcon, serviceLabel } from '../lib/util'
import { IRC_NETWORKS, ircNetworkFor } from '../lib/networks'
import type { Account } from '../../../shared/wire'

const ADDABLE = ['irc', 'discord', 'sneedchat', 'matrix', 'kick'] as const
type AddableService = (typeof ADDABLE)[number]

/**
 * Account states that make a service's group open itself.
 *
 * "connecting" is in here as well as the outright failures: an account that
 * is still trying is the other thing somebody opens this page to look at, and
 * it settles into "connected" on its own a moment later - at which point the
 * group folds away again without anybody doing anything.
 */
const TROUBLE_STATES = ['connecting', 'auth_failed', 'error']

export function AccountsPanel(): JSX.Element {
  const accounts = useChat((s) => s.accounts)
  const pendingLink = useChat((s) => s.pendingLink)
  // A link that could not be followed because there is no account on that
  // network yet opens this page with its form already showing. Nothing else
  // on the page would explain why you are here.
  const [adding, setAdding] = useState<AddableService | null>(
    pendingLink ? 'irc' : accounts.length === 0 ? 'irc' : null
  )
  useEffect(() => {
    if (pendingLink) setAdding('irc')
  }, [pendingLink])

  /**
   * Whether each service's accounts are shown, where somebody has said.
   *
   * A preference rather than component state: folding four IRC accounts away
   * is a decision about how this page should look, and having to make it
   * again on every visit is worse than not being able to make it at all.
   *
   * Absent means "decide for me", and the answer is closed - the pane is for
   * the things you do rarely, and a dozen accounts across five services made
   * it one long column - except for a service with an account in trouble.
   * Those open themselves, because an account that cannot connect is the one
   * reason to be on this page that nobody navigated here for.
   *
   * An explicit choice outranks that, in both directions: closing a group
   * that opened itself keeps it closed, which is somebody saying they know.
   */
  const [openGroups, setOpenGroups] = useMapPref<boolean>('accountGroupOpen')

  // Grouped by service, in the order the picker offers them, so the two
  // halves of this page agree about what order services come in.
  const byService = ADDABLE.map((service) => ({
    service,
    accounts: accounts.filter((a) => a.service === service)
  })).filter((group) => group.accounts.length > 0)

  return (
    <div className="panel">
      {/* Adding comes first now. It is the thing somebody opens this page to
          do that has no other route - an existing account can be reached by
          its own rail tile, and reading down a list of them to find the add
          section was the page's shape rather than anybody's intent. */}
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
        {adding === 'sneedchat' && <SneedChatForm />}
        {adding === 'matrix' && <MatrixForm />}
        {adding === 'kick' && <KickForm onDone={() => setAdding(null)} />}
      </div>

      <div className="panel-section">
        {accounts.length === 0 && (
          <p className="muted">
            No accounts yet. Pick a service above to connect one — nobilis keeps the connection
            alive in the background, so it survives closing this window.
          </p>
        )}

        {byService.map(({ service, accounts: mine }) => {
          const icon = serviceIcon(service)
          // A service worth looking at even unasked: something in it is not
          // working, or is on its way to working.
          const troubled = mine.some((a) => TROUBLE_STATES.includes(a.state))
          const shut = !(openGroups[service] ?? troubled)
          return (
            <div key={service} className="account-group">
              <button
                type="button"
                className="account-group-head"
                aria-expanded={!shut}
                onClick={() => setOpenGroups(service, shut)}
              >
                <Icon name={shut ? 'chevron_right' : 'expand_more'} size={18} />
                {icon.mark ? <MaskIcon src={icon.mark} size={16} /> : <Icon name={icon.glyph!} size={16} />}
                <span className="account-group-name">{serviceLabel(service)}</span>
                {/* The count is what makes a folded heading worth reading. */}
                <span className="small muted">{mine.length}</span>
              </button>
              {!shut && mine.map((account) => <AccountRow key={account.id} account={account} />)}
            </div>
          )
        })}
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
  // What the daemon last said about why. Only meaningful while something is
  // wrong, which is exactly when the state line alone explains nothing.
  const detail = useChat((st) => st.connectionDetail)[account.id]

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
          {detail && <div className="small muted ellipsis account-detail" title={detail}>{detail}</div>}
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
          {/* Local, and it says so: the service is never told, and being
              addressed is still decided against the name the service knows
              you by - so calling yourself "You" cannot stop anyone reaching
              you. It changes what moho calls you, mentions of you included. */}
          <LabeledInput
            label="Display name"
            defaultValue={account.displayName}
            placeholder="What moho calls you here"
            onCommit={(name) => call('setAccountDisplayName', { accountId: account.id, name })}
          />
          <div className="small muted">
            Only here. Mentions of you are shown with this name; who can ping
            you does not change.
          </div>

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
              <IrcSasl account={account} call={call} />
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

          {account.service === 'sneedchat' && <SneedChatBrowserLogin accountId={account.id} />}

          {account.service === 'kick' && <KickFollowSync account={account} />}

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

/**
 * Signing in to an IRC network with SASL rather than by messaging NickServ.
 *
 * Worth preferring where it exists: it happens during registration, so the
 * account is identified before the first channel is joined - which is what
 * makes cloaks and invite-only channels work on the first attempt instead of
 * after a race with NickServ that IRC gives no way to wait on.
 *
 * All four fields are one settings call, because the daemon stores them
 * together and sending them apart would let a half-applied change - a username
 * without the password it goes with - decide a connection attempt.
 */
function IrcSasl({
  account,
  call
}: {
  account: Account
  call: (method: string, params: Record<string, unknown>) => void
}): JSX.Element {
  const [username, setUsername] = useState(account.saslUsername)
  const [password, setPassword] = useState('')
  const [allowPlaintext, setAllowPlaintext] = useState(account.allowPlaintextSasl)

  const apply = (patch: {
    enabled?: boolean
    saslUser?: string
    allowPlaintextSasl?: boolean
    saslMechanism?: string
    saslCertPath?: string
  }): void =>
    call('setAccountSasl', {
      accountId: account.id,
      enabled: account.saslEnabled,
      saslUser: username,
      // Empty means "leave the stored one alone" - the daemon never reads a
      // password back out, so there is nothing to prefill and clearing the
      // box must not be read as clearing the credential.
      password,
      allowPlaintextSasl: allowPlaintext,
      ...patch
    })

  return (
    <div className="sasl-block">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={account.saslEnabled}
          onChange={(e) => apply({ enabled: e.target.checked })}
        />
        <span>
          Authenticate with SASL
          <span className="small muted">
            {' '}
            — identifies during connection, before any channel is joined
          </span>
        </span>
      </label>

      {account.saslEnabled && (
        <>
          <LabeledInput
            label="SASL username"
            defaultValue={account.saslUsername}
            placeholder={account.id.split('@')[0] || 'your account name'}
            onCommit={(value) => {
              setUsername(value)
              apply({ saslUser: value })
            }}
          />
          <LabeledInput
            label="SASL password"
            type="password"
            placeholder={account.hasPassword ? '(set)' : 'unset'}
            onCommit={(value) => {
              setPassword(value)
              call('setAccountSasl', {
                accountId: account.id,
                enabled: true,
                saslUser: username,
                password: value,
                allowPlaintextSasl: allowPlaintext
              })
            }}
          />

          {/* How the password is proved, where it is proved at all.
              Defaulted rather than chosen, because the default is right for
              nearly everyone and the alternatives each need something the
              network has to support first. */}
          <label className="field">
            <span className="small muted">Mechanism</span>
            <select
              className="text-field"
              value={account.saslMechanism}
              onChange={(e) => apply({ saslMechanism: e.target.value })}
            >
              <option value="">Automatic — a certificate if set, otherwise PLAIN</option>
              <option value="plain">PLAIN — the password, inside TLS</option>
              <option value="scram-sha-256">SCRAM-SHA-256 — proves the password without sending it</option>
              <option value="external">EXTERNAL — the client certificate, no password at all</option>
            </select>
          </label>

          {/* Only where the mechanism needs one. EXTERNAL is the certificate;
              everything else ignores it, and a path field beside PLAIN would
              read as something that does nothing. */}
          {(account.saslMechanism === 'external' || account.hasSaslCertificate) && (
            <LabeledInput
              label="Client certificate"
              defaultValue={account.hasSaslCertificate ? '(set)' : ''}
              placeholder="/path/to/cert.pem on the daemon's machine"
              onCommit={(value) => apply({ saslCertPath: value === '(set)' ? undefined : value })}
            />
          )}

          {/* SCRAM proves the password to the server without sending it, and
              proves the server knew it too - worth saying, because that second
              half is the part people do not expect from a login. */}
          {account.saslMechanism === 'scram-sha-256' && (
            <p className="small muted">
              Few IRC networks offer SCRAM — Ergo does, Libera and Rizon do not. If this server
              refuses it and says what it does accept, moho falls back to that automatically.
            </p>
          )}

          {/* Only where it is a live question. On a TLS connection the
              allowance decides nothing, and offering it there would be a
              switch that appears to weaken something and does not. */}
          {!account.ssl && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={account.allowPlaintextSasl}
                onChange={(e) => {
                  setAllowPlaintext(e.target.checked)
                  apply({ allowPlaintextSasl: e.target.checked })
                }}
              />
              <span>
                Send SASL credentials over this unencrypted connection
                <span className="small muted">
                  {' '}
                  — SASL PLAIN is the password with base64 round it, not encryption. Without
                  this, connecting is refused rather than done quietly in the clear.
                </span>
              </span>
            </label>
          )}
        </>
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
  // What a link already knew. Everything it carries is filled in; the nick is
  // the one thing it cannot supply, which is why the form is shown at all
  // rather than the account simply being made.
  const link = useChat((s) => s.pendingLink)
  const [nick, setNick] = useState('')
  const [host, setHost] = useState(link?.host ?? '')
  const [port, setPort] = useState(String(link?.port ?? (link?.tls === false ? 6667 : 6697)))
  const [ssl, setSsl] = useState(link?.tls ?? true)
  // What a link asked to join, carried straight through. There is no field
  // for it: which channels an account joins on connect is a property of the
  // channels, and is set on them - see the buffer list's own menu.
  const autojoin = link?.channels.join(',') ?? ''
  /**
   * How this account proves who it is, if at all.
   *
   * Asked here rather than left to the account's settings afterwards, because
   * a nick that is registered and not identified is a nick you lose to the
   * ghost of your last session - which happens on the first connection, well
   * before anybody goes looking for a settings pane.
   *
   * SASL and NickServ are both offered because networks differ: SASL
   * identifies before anything else happens, which is what a channel with
   * +r wants, and the older networks have only NickServ.
   */
  const [auth, setAuth] = useState<'none' | 'sasl' | 'nickserv'>('none')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  // Only a network nobody picked from the tiles needs its address typed, and
  // showing those fields for one that was picked invites editing a hostname
  // that is already right.
  const chosen = ircNetworkFor(host)

  const submit = async (): Promise<void> => {
    if (!nick || !host) return
    setBusy(true)
    try {
      await window.moho.rpc('addAccount', {
        nick,
        host,
        port: Number(port) || undefined,
        ssl,
        autojoin,
        // SASL's own password field is the account password; NickServ's is
        // sent as a message after connecting, which is a different thing and
        // a different call.
        ...(auth === 'sasl' ? { sasl: true, saslUser: nick, password } : {})
      })
      if (auth === 'nickserv' && password) {
        await window.moho.rpc('setAccountNickservPassword', {
          accountId: `${nick}@${host}`,
          password
        })
      }
      await store.refreshAccounts()
      store.clearPendingLink()
      onDone()
    } catch (e) {
      store.toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="add-form">
      {/* Typing a hostname and port correctly is the one step here where a
          small mistake looks like the server being down, so the networks
          people actually join are offered ready-made. Choosing one fills
          the fields rather than hiding them: they stay editable, and a
          network not on the list is typed in exactly as before. */}
      <div className="field">
        <span className="small muted">Network</span>
        {/* Tiles rather than a dropdown, now that these carry the networks'
            own logos: a list of names says nothing a person recognises,
            and a wall of marks is how anybody actually finds the network
            they are on. "Other" stays first, because a network not on the
            list is typed in exactly as before. */}
        <div className="network-grid">
          <button
            type="button"
            className={classes('network-tile', !ircNetworkFor(host) && 'active')}
            onClick={() => setHost('')}
          >
            <span className="network-mark network-mark-other">
              <Icon name="add" size={18} />
            </span>
            <span className="small ellipsis">Other</span>
          </button>
          {IRC_NETWORKS.map((n) => (
            <button
              key={n.id}
              type="button"
              className={classes('network-tile', ircNetworkFor(host)?.id === n.id && 'active')}
              title={`${n.host}:${n.port}`}
              onClick={() => {
                setHost(n.host)
                setPort(String(n.port))
                setSsl(n.tls)
              }}
            >
              <span className="network-mark" style={{ background: n.colour }}>
                {n.logo ? <img src={n.logo} alt="" /> : n.mark}
              </span>
              <span className="small ellipsis">{n.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="small muted">Nickname</span>
          <input className="text-field" value={nick} onChange={(e) => setNick(e.target.value)} />
        </label>
        {/* Only for a network that was not picked. A chosen one has its
            address already, and a field showing it invites editing something
            that is right. */}
        {!chosen && (
          <>
            <label className="field">
              <span className="small muted">Server</span>
              <input
                className="text-field"
                placeholder="irc.example.net"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <label className="field port">
              <span className="small muted">Port</span>
              <input className="text-field" value={port} onChange={(e) => setPort(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {/* How to identify. Three choices rather than two switches, because
          they are alternatives: a network wants one or the other, and asking
          for both would be asking somebody to type their password twice. */}
      <div className="field">
        <span className="small muted">Sign in</span>
        <div className="field-row">
          {(
            [
              ['none', 'No account'],
              ['sasl', 'SASL'],
              ['nickserv', 'NickServ']
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="checkbox-row">
              <input
                type="radio"
                name="irc-auth"
                checked={auth === value}
                onChange={() => setAuth(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {auth !== 'none' && (
          <input
            className="text-field"
            type="password"
            placeholder={auth === 'sasl' ? 'Account password' : 'NickServ password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {auth === 'sasl' && (
          <span className="small muted">
            Identifies before joining anything, using your nickname as the account name.
          </span>
        )}
        {auth === 'nickserv' && (
          <span className="small muted">
            Sent to NickServ after connecting, and used to reclaim your nick from a stale session.
          </span>
        )}
      </div>

      {!chosen && (
        <label className="checkbox-row">
          <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
          <span>Use TLS</span>
        </label>
      )}
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
  const [method, setMethod] = useState<'qr' | 'browser'>('qr')
  // No password state any more, deliberately: the password is typed into
  // Discord's own page in the sign-in window, so this process never holds one.
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
          className={method === 'browser' ? 'active' : undefined}
          onClick={() => setMethod('browser')}
        >
          Browser
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
          <p className="small muted">
            Opens Discord&apos;s own sign-in page in a browser window. Your password goes into
            their form and never passes through moho — and because it is their page, their
            captcha, two-factor and device checks all work normally. The window is thrown away
            afterwards, session and all.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              store.setDiscordLoginStatus('Waiting for the sign-in window…')
              void window.moho
                .browserLogin('discord', accountId || undefined)
                .then((r) => {
                  setBusy(false)
                  // Closing the window is a decision, not a failure worth
                  // shouting about.
                  if (r.ok) store.setDiscordLoginStatus('Signed in.')
                  else if (r.error === 'cancelled') store.setDiscordLoginStatus('')
                  else fail(new Error(r.error || 'Sign-in failed'))
                })
                .catch(fail)
            }}
          >
            {busy ? 'Waiting…' : accountId ? 'Re-authenticate in a browser' : 'Sign in with a browser'}
          </button>
        </>
      )}
      {status && <p className="small muted">{status}</p>}
    </div>
  )
}

/**
 * Reads this account's Kick follows again.
 *
 * Here rather than automatic, and that is the trade being made explicit: the
 * follows are read once, when the account is first connected, because a list
 * re-read on every connect would put back every channel the person had closed.
 * The cost of that is a streamer followed later never turning up on its own -
 * so this is the way to ask, and it is the person asking.
 *
 * Adds only. By now the list belongs to whoever is using it, and a sync that
 * also removed things would be the same overreach in the other direction - so
 * un-following on Kick closes nothing here.
 *
 * It will, though, reopen a channel that was closed earlier, because from
 * here that channel is simply one you follow and are not watching. That is
 * what the button says it does, and it is said plainly below rather than left
 * to be discovered: the automatic sync is the one that must never resurrect a
 * closed channel, since nobody asked it to run.
 */
function KickFollowSync({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const sync = (): void => {
    setBusy(true)
    setResult('')
    void window.moho
      .rpc<{ added: number; channels: string[]; connected: boolean }>('syncKickFollows', {
        accountId: account.id
      })
      .then((r) => {
        // Named rather than counted where there are few enough to read: "3
        // added" sends somebody looking for which three.
        if (r.added === 0) setResult('Already watching everything you follow.')
        else if (r.channels.length <= 4) setResult(`Now watching ${r.channels.join(', ')}.`)
        else setResult(`Now watching ${r.added} more channels.`)
        // Persisted either way, so this is a note about when rather than an
        // error about whether.
        if (r.added > 0 && !r.connected) setResult((s) => `${s} They will open when the account reconnects.`)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="sasl-block">
      <span className="small muted">Follows</span>
      <p className="small muted">
        Your follows were read in when this account was added, and not since — so anyone you have
        followed after that is not here yet. This opens them, along with any followed channel you
        closed earlier. Un-following on Kick closes nothing here.
      </p>
      <button type="button" className="button" disabled={busy} onClick={sync}>
        {busy ? 'Reading your follows…' : 'Sync my follows'}
      </button>
      {result && <p className="small muted">{result}</p>}
    </div>
  )
}

/**
 * Kick is the only account here that is useful without signing in, so this
 * form offers both and puts watching first.
 *
 * That ordering is the honest one rather than a nudge: Kick's chat is public,
 * so a reader needs no credential and asking for one before showing them
 * anything would be asking for a password that buys nothing they came for.
 * Signing in buys two specific things, and they are named rather than implied.
 */
function KickForm({ onDone }: { onDone: () => void }): JSX.Element {
  const store = useStore()
  const [busy, setBusy] = useState(false)

  const add = (token?: string): void => {
    setBusy(true)
    void window.moho
      .rpc('addKickAccount', token ? { token } : {})
      .then(() => onDone())
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="add-form">
      <p className="small muted">
        Kick chat is public, so you can watch any streamer without an account. Signing in adds
        two things: talking, and the subscriber emotes of the channels you subscribe to.
      </p>
      <div className="field-row">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void window.moho
              .browserLogin('kick')
              .then((r) => {
                setBusy(false)
                // Closing the window is a decision, not a failure worth
                // shouting about - the same rule as Discord's above.
                if (r.ok) onDone()
                else if (r.error && r.error !== 'cancelled') store.toast('error', r.error)
              })
              .catch((e: Error) => {
                setBusy(false)
                store.toast('error', e.message)
              })
          }}
        >
          {busy ? 'Waiting…' : 'Sign in with a browser'}
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => add()}>
          Just watch
        </button>
      </div>
      <p className="small muted">
        Signing in opens Kick&apos;s own page in a browser window. Your password goes into their
        form and never passes through moho, and the window is thrown away afterwards.
      </p>
    </div>
  )
}

/**
 * Signing in to the forum by hand, because its login form now asks for one.
 *
 * The site added a CAPTCHA to the login form, and a CAPTCHA is precisely a
 * question a program is not meant to answer - so moho stops trying and asks
 * the person instead. The window is the site's own login page; what comes
 * back from it is the session, which is all the daemon ever wanted a password
 * for. It is a workaround and reads like one on purpose.
 *
 * The window reaches the site over the ordinary internet rather than through
 * moho's Tor client, since Chromium has no Tor of its own. The session it
 * returns belongs to the forum rather than to one of its addresses, so the
 * daemon goes on connecting however it was configured to.
 */
function SneedChatBrowserLogin({ accountId }: { accountId?: string }): JSX.Element {
  const store = useStore()
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void window.moho
            .browserLogin('sneedchat', accountId)
            .then((r) => {
              setBusy(false)
              if (r.ok) {
                store.toast('info', 'Signed in. Connecting…')
                void store.refreshAccounts()
                // Closing the window is a decision rather than a failure.
              } else if (r.error && r.error !== 'cancelled') {
                store.toast('error', r.error)
              }
            })
            .catch((e: Error) => {
              setBusy(false)
              store.toast('error', e.message)
            })
        }}
      >
        {busy ? 'Waiting for the sign-in window…' : 'Sign in with a browser'}
      </button>
      <div className="small muted">
        The forum now asks for a CAPTCHA when signing in, which moho cannot answer. This opens
        their login page in a window so you can answer it yourself; moho keeps the session that
        comes back. Your password goes into their form and never passes through moho.
      </div>
    </>
  )
}

/**
 * Sneedchat login runs over the embedded Tor client and may have to solve the
 * site's proof-of-work gate, so it can take anywhere from instant to over a
 * minute - hence the same async-kickoff shape as Discord's QR flow.
 */
function SneedChatForm(): JSX.Element {
  const store = useStore()
  const status = useChat((s) => s.sneedChatLoginStatus)
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
            .rpc('addSneedChatAccount', {
              username,
              password,
              ...(totpSecret ? { totpSecret } : {})
            })
            .then(() => store.setSneedChatLoginStatus('Bootstrapping Tor…'))
            .catch((e: Error) => store.toast('error', e.message))
        }
      >
        Connect
      </button>
      {/* Second because it can only follow the first: the browser hands back
          a session, and a session has to belong to an account that exists. */}
      <SneedChatBrowserLogin />
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
          placeholder="matrix.org"
          value={homeserverUrl}
          onChange={(e) => setHomeserverUrl(e.target.value)}
        />
      </label>
      {/* Said here because the two ways this goes wrong both look like a
          wrong password. The daemon asks the server where its client API is,
          so the domain from your address is usually the right answer even
          when the API lives elsewhere - and :8448 never is, because that is
          the port servers talk to each other on. */}
      <p className="small muted">
        The domain from your Matrix address is usually right — moho asks the server where its
        client API actually lives. Not the :8448 port, which is for server-to-server traffic.
      </p>
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
      <div className="field-row">
        <button
          type="button"
          className="button"
          disabled={!userId || !password}
          onClick={() =>
            void window.moho
              .rpc('addMatrixAccount', {
                homeserverUrl,
                // Tolerate a pasted full MXID as well as a bare username:
                // strip the leading @ and anything from the first ':' onward.
                userId: userId.replace(/^@/, '').split(':')[0],
                password
              })
              .then(() => store.setMatrixLoginStatus('Logging in…'))
              .catch((e: Error) => store.toast('error', e.message))
          }
        >
          Log in
        </button>
        {/* The other way in, and for many homeservers the only way: the
            server's own web login in a browser, coming back with a one-time
            token. Needs no username or password here because the point is
            that somebody else asks for them. */}
        <button
          type="button"
          className="button subtle"
          disabled={!homeserverUrl}
          onClick={() =>
            void window.moho
              .rpc('addMatrixAccountSso', { homeserverUrl })
              .then(() => store.setMatrixLoginStatus('Opening your browser…'))
              .catch((e: Error) => store.toast('error', e.message))
          }
        >
          Sign in with SSO
        </button>
      </div>
      {status && <p className="small muted">{status}</p>}
      <p className="small muted">
        New sessions start unverified. Once logged in, verify this device from another signed-in
        session so encrypted history decrypts.
      </p>
    </div>
  )
}

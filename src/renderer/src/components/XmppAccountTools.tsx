import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { SwitchRow } from './Switch'
import { AccountFace, Asking, SideTabs, ToolPane } from './AccountList'
import { XmppDataForm, type XmppForm } from './XmppDataForm'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/**
 * What the account's card offers when the server will not let it in: the certificate it showed, to be looked at and
 * trusted or not, and a new password for one it refused.
 */
export function XmppAccountTools({ account }: { account: Account }): JSX.Element | null {
  // Signed in, everything the server offers the account, a section each. Turned away, only what puts it right: the
  // certificate or the password, and the settings it connects with.
  if (account.state === 'connected') return <XmppConnectedTools account={account} />
  return (
    <div className="card">
      <XmppStoppedTools account={account} />
      <XmppConnectionSettings account={account} />
    </div>
  )
}

/** The card's state line for an XMPP account, in words: what stopped it, rather than "auth_failed". */
export function xmppStateWords(account: Account): string {
  if (account.state !== 'auth_failed') return account.state
  switch (account.stopReason) {
    case 'password':
      return 'needs a password'
    case 'certificate':
      return 'certificate not trusted'
    case 'certificate-changed':
      return 'certificate changed'
    case 'setup':
      return 'settings need a look'
    default:
      return 'stopped'
  }
}

interface CertDetails {
  subject: string
  issuer: string
  notBefore: string
  notAfter: string
  names: string[]
  selfSigned: boolean
}

interface XmppSettings {
  jid: string
  host: string
  port: number
  security: 'starttls' | 'direct' | 'websocket'
  caPem: string
  pinSha256: string
  clientCertPem: string
  pinned: CertDetails | null
  resource: string
  lastConnected: string
  lastMechanism: string
  fastToken: boolean
  fastExpiry: string
  scramOnly: boolean
}

const day = (iso: string): string => (iso ? new Date(iso).toLocaleString() : '')

/** What a certificate says about itself, for somebody deciding whether to trust it. */
function CertificateFacts({ details }: { details: CertDetails }): JSX.Element {
  return (
    <dl className="facts small">
      <dt>Issued to</dt>
      <dd className="mono">{details.subject || '(nobody named)'}</dd>
      <dt>Names</dt>
      <dd className="mono">{details.names.join(', ') || '(none)'}</dd>
      <dt>Signed by</dt>
      <dd className="mono">{details.selfSigned ? 'itself (self-signed)' : details.issuer}</dd>
      <dt>Valid</dt>
      <dd>
        {day(details.notBefore)} – {day(details.notAfter)}
        {new Date(details.notAfter) < new Date() ? ' (expired)' : ''}
      </dd>
    </dl>
  )
}

/**
 * How the account reaches its server, changed in place: the server and port, the security, the authority or the one certificate
 * it trusts, the resource. And how it last signed in. Saved settings make it connect again with them.
 */
function XmppConnectionSettings({ account, always }: { account: Account; always?: boolean }): JSX.Element {
  const store = useStore()
  // On a page of its own it is simply there; under a stopped account it is behind a button, out of the way of what stopped it.
  const [open, setOpen] = useState(!!always)
  const [s, setS] = useState<XmppSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const load = (): void => void window.moho.rpc<XmppSettings>('getXmppSettings', { accountId: account.id }).then(setS).catch((e: Error) => store.toast('error', e.message))
  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.state])
  const save = (): void => {
    if (!s) return
    setBusy(true)
    void window.moho
      .rpc<{ changed: boolean }>('editXmppAccount', { accountId: account.id, host: s.host, port: Number(s.port) || 0, security: s.security, caPem: s.caPem, pinSha256: s.pinSha256, resource: s.resource, clientCertPem: s.clientCertPem })
      .then((r) => {
        store.toast('info', r.changed ? 'Saved; connecting with the new settings' : 'Nothing changed')
        void store.refreshAccounts()
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const set = (patch: Partial<XmppSettings>): void => setS(s ? { ...s, ...patch } : s)
  return (
    <div className="account-tools">
      {!always && (
        <button type="button" className="button quiet small" onClick={() => setOpen(!open)}>
          {open ? 'Hide connection settings' : 'Connection settings'}
        </button>
      )}
      {open && s && (
        <div className={always ? 'tool-fields' : 'add-form'}>
          {s.lastConnected && (
            <p className="small muted">
              Last signed in {day(s.lastConnected)}
              {s.lastMechanism ? ` with ${s.lastMechanism}` : ''}
              {s.fastToken ? `; it has a sign-in token${s.fastExpiry ? ` until ${day(s.fastExpiry)}` : ''}, so it reconnects without sending the password` : ''}.
              {s.scramOnly ? ' The password is only ever sent hashed (SCRAM): a server that offers only PLAIN is refused.' : ''}
            </p>
          )}
          <div className="field-row">
            <label className="field">
              <span className="small muted">{s.security === 'websocket' ? 'WebSocket address (wss://…, or empty to look it up)' : 'Server (empty to look it up)'}</span>
              <input className="text-field" autoComplete="off" spellCheck={false} placeholder="xmpp.example.org" value={s.host} disabled={busy} onChange={(e) => set({ host: e.target.value })} />
            </label>
            <label className="field">
              <span className="small muted">Port</span>
              <input className="text-field" inputMode="numeric" placeholder={s.security === 'direct' ? '5223' : '5222'} value={s.port || ''} disabled={busy} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
            </label>
          </div>
          <div className="segmented">
            {(['starttls', 'direct', 'websocket'] as const).map((m) => (
              <button key={m} type="button" className={s.security === m ? 'active' : undefined} disabled={busy} onClick={() => set({ security: m })}>
                {m === 'starttls' ? 'STARTTLS' : m === 'direct' ? 'Direct TLS' : 'WebSocket'}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="small muted">Certificate authority to trust, besides the system&apos;s (PEM)</span>
            <textarea className="text-field" rows={3} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" value={s.caPem} disabled={busy} onChange={(e) => set({ caPem: e.target.value })} />
          </label>
          <label className="field">
            <span className="small muted">Trusted certificate (SHA-256 fingerprint), whatever signed it</span>
            <input className="text-field mono" autoComplete="off" spellCheck={false} placeholder="ab:cd:… (64 hex digits)" value={s.pinSha256} disabled={busy} onChange={(e) => set({ pinSha256: e.target.value })} />
          </label>
          {s.pinned && s.pinSha256 && <CertificateFacts details={s.pinned} />}
          <label className="field">
            <span className="small muted">Client certificate and its key (PEM), for a server that signs in by certificate</span>
            <textarea className="text-field" rows={3} spellCheck={false} value={s.clientCertPem} disabled={busy} onChange={(e) => set({ clientCertPem: e.target.value })} />
          </label>
          <label className="field">
            <span className="small muted">Resource (this device&apos;s name to the server; a server that offers Bind 2 chooses it)</span>
            <input className="text-field mono" autoComplete="off" spellCheck={false} value={s.resource} disabled={busy} onChange={(e) => set({ resource: e.target.value })} />
          </label>
          <div className="field-row">
            <button type="button" className="button primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save and reconnect'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface ServerInfo {
  software?: string | null
  version?: string | null
  contacts: Record<string, string[]>
  features: { var: string; xep?: string | null }[]
}

interface PrivacyRule {
  type: string
  value: string
  action: string
  order: number
  what: string[]
}

interface CommandStep {
  status: string
  sessionId: string
  form: XmppForm | null
  notes: [string, string][]
  actions: string[]
}

/** What an account that is signed in can do on its server: its picture, its password, who it has blocked, what the server is, and
 * the server's own commands. */
function XmppConnectedTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [askImported, setAskImported] = useState(true)
  // Always one of them: the page has the room now, and a row of buttons with nothing under it was the fold-down's shape.
  const [section, setSection] = useState<'profile' | 'invite' | 'contacts' | 'published' | 'privacy' | 'picture' | 'password' | 'blocked' | 'archive' | 'server' | 'commands' | 'connection' | 'delete'>('profile')
  const [nodes, setNodes] = useState<{ node: string; what: string; access: string; items: number; usedHere: boolean }[] | null>(null)
  const [privacy, setPrivacy] = useState<{ names: string[]; default: string; active: string } | null>(null)
  const [listName, setListName] = useState('')
  const [rules, setRules] = useState<{ rule: PrivacyRule; words: string }[]>([])
  const [newRule, setNewRule] = useState<PrivacyRule>({ type: 'jid', value: '', action: 'deny', order: 0, what: ['message'] })
  const [inviteKinds, setInviteKinds] = useState<string[] | null>(null)
  const [invite, setInvite] = useState<{ uri: string; landingUrl: string; expires: string } | null>(null)
  const [me, setMe] = useState<{ fullName: string; nickname: string; email: string; url: string; note: string } | null>(null)
  const [password, setPassword] = useState('')
  const [blocked, setBlocked] = useState<string[]>([])
  const [toBlock, setToBlock] = useState('')
  const [report, setReport] = useState(false)
  const [keeps, setKeeps] = useState('always')
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [commands, setCommands] = useState<{ node: string; name: string }[] | null>(null)
  const [step, setStep] = useState<CommandStep | null>(null)
  const [node, setNode] = useState('')
  const [typed, setTyped] = useState('')
  const say = (e: Error): void => store.toast('error', e.message)
  const call = <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => window.moho.rpc<T>(method, { accountId: account.id, ...params })

  useEffect(() => {
    if (section === 'published') void call<{ nodes: { node: string; what: string; access: string; items: number; used_here: boolean }[] }>('xmppNodes').then((r) => setNodes(r.nodes.map((n) => ({ ...n, usedHere: n.used_here })))).catch(say)
    if (section === 'privacy') void call<{ names: string[]; default: string; active: string }>('xmppPrivacyLists').then(setPrivacy).catch(say)
    if (section === 'invite') void call<{ kinds: string[] }>('xmppInviteKinds').then((r) => setInviteKinds(r.kinds)).catch(say)
    if (section === 'profile') void call<{ fullName: string; nickname: string; email: string; url: string; note: string }>('xmppGetProfile').then(setMe).catch(say)
    if (section === 'blocked') void call<{ blocked: string[] }>('xmppBlocklist').then((r) => setBlocked(r.blocked)).catch(say)
    if (section === 'archive') void call<{ default: string }>('xmppArchivePrefs').then((r) => setKeeps(r.default)).catch(say)
    if (section === 'server') void call<ServerInfo>('xmppServerInfo').then(setInfo).catch(say)
    if (section === 'commands') void call<{ commands: { node: string; name: string }[] }>('xmppCommands').then((r) => setCommands(r.commands)).catch(say)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const run = (n: string, action = 'execute', answers: Record<string, unknown> = {}): void => {
    setNode(n)
    void call<CommandStep>('xmppCommand', { node: n, sessionId: step?.sessionId ?? '', action, form: step?.form ?? undefined, answers })
      .then((r) => setStep(r.status === 'executing' ? r : { ...r, form: r.form }))
      .catch(say)
  }
  const server = account.displayName.split('@')[1] ?? accountServer(account.id)
  return (
    <SideTabs
      label="XMPP"
      value={section}
      onChange={setSection}
      groups={[
        {
          label: 'You',
          items: [
            { id: 'profile', label: 'Profile', icon: 'badge' },
            { id: 'picture', label: 'Picture', icon: 'account_circle' },
            { id: 'password', label: 'Password', icon: 'key' }
          ]
        },
        {
          label: 'People',
          items: [
            { id: 'contacts', label: 'Contacts', icon: 'contacts' },
            { id: 'invite', label: 'Invite', icon: 'mail' },
            { id: 'blocked', label: 'Blocked', icon: 'block' },
            { id: 'privacy', label: 'Privacy lists', icon: 'shield' }
          ]
        },
        {
          label: server || 'Server',
          items: [
            { id: 'published', label: 'Published', icon: 'publish' },
            { id: 'archive', label: 'History', icon: 'history' },
            { id: 'server', label: 'Server', icon: 'dns' },
            { id: 'commands', label: 'Commands', icon: 'terminal' },
            { id: 'connection', label: 'Connection settings', icon: 'lan' }
          ]
        },
        { label: '', items: [{ id: 'delete', label: 'Delete', icon: 'delete_forever', danger: true }] }
      ]}
    >
      {section === 'profile' && (
        <ToolPane title="Profile" desc="What others see when they look at this account (its vCard and nickname). Anybody can read the vCard; the nickname is for contacts.">
          {me ? (
            <div className="card card-fields">
              <div className="tool-grid">
                {(
                  [
                    ['fullName', 'Name'],
                    ['nickname', 'Nickname'],
                    ['email', 'E-mail'],
                    ['url', 'Website']
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="field">
                    <span className="field-label">{label}</span>
                    <input className="text-field" autoComplete="off" value={me[key]} onChange={(e) => setMe({ ...me, [key]: e.target.value })} />
                  </label>
                ))}
              </div>
              <label className="field">
                <span className="field-label">About</span>
                <textarea className="text-field" rows={3} value={me.note} onChange={(e) => setMe({ ...me, note: e.target.value })} />
              </label>
              <div className="tool-actions">
                <button type="button" className="button primary" onClick={() => void call('xmppSetProfile', me).then(() => store.toast('info', 'Profile published')).catch(say)}>
                  Publish
                </button>
              </div>
            </div>
          ) : (
            <Asking />
          )}
        </ToolPane>
      )}

      {section === 'picture' && (
        <ToolPane title="Picture" desc="The picture your contacts and the rooms you are in show for you.">
          <div className="card">
            <div className="setting-row">
              <AccountFace account={account} size={48} />
              <div className="setting-text">
                <div>{account.avatarUrl ? 'Your picture' : 'No picture yet'}</div>
                <div className="small muted">Published on {server || 'your server'}, for anybody who looks.</div>
              </div>
              <button
                type="button"
                className="button primary"
                onClick={() =>
                  void window.moho.pickFile().then((path) => {
                    if (path) void call('xmppSetAvatar', { path }).then(() => store.toast('info', 'Picture changed')).catch(say)
                  })
                }
              >
                Choose a picture…
              </button>
              <button type="button" className="button quiet" onClick={() => void call('xmppSetAvatar', { path: '' }).then(() => store.toast('info', 'Picture taken off')).catch(say)}>
                Take it off
              </button>
            </div>
          </div>
        </ToolPane>
      )}

      {section === 'password' && (
        <ToolPane title="Password" desc="Changes it on the server, for every client of this account. moho keeps the new one and stays signed in.">
          <div className="card card-fields">
            <label className="field">
              <span className="field-label">New password</span>
              <div className="action-field">
                <input className="text-field" type="password" autoComplete="off" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button
                  type="button"
                  className="button primary"
                  disabled={!password}
                  onClick={() =>
                    void call('xmppChangePassword', { password })
                      .then(() => {
                        setPassword('')
                        store.toast('info', 'Password changed')
                      })
                      .catch(say)
                  }
                >
                  Change
                </button>
              </div>
            </label>
          </div>
        </ToolPane>
      )}

      {section === 'contacts' && (
        <ToolPane title="Contacts" desc="The contact list as a file: the roster as XMPP writes it, which other clients and servers read. A file of addresses, one a line, is read too.">
          <div className="card">
            <div className="setting-row">
              <div className="setting-text">
                <div>Save the contact list</div>
                <div className="small muted">Everybody on it, with their names and groups.</div>
              </div>
              <button
                type="button"
                className="button quiet"
                onClick={() =>
                  void window.moho.pickSavePath(`${account.displayName || 'contacts'}.roster.xml`).then((path) => {
                    if (path) void call<{ exported: number }>('xmppExportContacts', { path }).then((r) => store.toast('info', `${r.exported} contacts saved`)).catch(say)
                  })
                }
              >
                Save…
              </button>
            </div>
            <div className="setting-row">
              <div className="setting-text">
                <div>Add contacts from a file</div>
                <div className="small muted">Those already on the list are left as they are.</div>
              </div>
              <button
                type="button"
                className="button quiet"
                onClick={() =>
                  void window.moho.pickFile().then((path) => {
                    if (path)
                      void call<{ added: number; kept: number; failed: string[] }>('xmppImportContacts', { path, ask: askImported })
                        .then((r) => store.toast(r.failed.length ? 'error' : 'info', `${r.added} added, ${r.kept} already there${r.failed.length ? `; not added: ${r.failed.join('; ')}` : ''}`))
                        .catch(say)
                  })
                }
              >
                Choose a file…
              </button>
            </div>
            <SwitchRow
              title="Ask each new contact to share their presence"
              description="As adding one by hand does"
              checked={askImported}
              onChange={setAskImported}
            />
          </div>
        </ToolPane>
      )}

      {section === 'invite' && (
        <ToolPane title="Invite" desc="A link that makes somebody a contact without the request waiting for an answer, or lets them make an account on this server.">
          {inviteKinds ? (
            <div className="card">
              {inviteKinds.length === 0 && (
                <div className="setting-row">
                  <div className="setting-text">
                    <div>This server does not make invitations</div>
                    <div className="small muted">It would need XEP-0401.</div>
                  </div>
                </div>
              )}
              {inviteKinds.includes('contact') && (
                <div className="setting-row">
                  <div className="setting-text">
                    <div>Invite somebody to be a contact</div>
                    <div className="small muted">Opened in an XMPP client, it adds you both.</div>
                  </div>
                  <button type="button" className="button quiet" onClick={() => void call<{ uri: string; landingUrl: string; expires: string }>('xmppCreateInvite', { kind: 'contact' }).then(setInvite).catch(say)}>
                    Make a link
                  </button>
                </div>
              )}
              {inviteKinds.includes('account') && (
                <div className="setting-row">
                  <div className="setting-text">
                    <div>Invite somebody to make an account here</div>
                    <div className="small muted">For a server that takes new accounts by invitation.</div>
                  </div>
                  <button type="button" className="button quiet" onClick={() => void call<{ uri: string; landingUrl: string; expires: string }>('xmppCreateInvite', { kind: 'account' }).then(setInvite).catch(say)}>
                    Make a link
                  </button>
                </div>
              )}
              {invite && (
                <div className="tool-fields">
                  <p className="small muted">Send them this{invite.expires ? `; it works until ${new Date(invite.expires).toLocaleString()}` : ''}.</p>
                  {[invite.landingUrl, invite.uri].filter(Boolean).map((link) => (
                    <div key={link} className="action-field">
                      <input className="text-field mono" readOnly value={link} onFocus={(e) => e.target.select()} />
                      <button type="button" className="button quiet" onClick={() => void window.moho.copyText(link).then(() => store.toast('info', 'Copied'))}>
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Asking />
          )}
        </ToolPane>
      )}

      {section === 'blocked' && (
        <ToolPane title="Blocked" desc="Addresses and whole servers your server turns away for you, on every client of this account.">
          <div className="card card-fields">
            <label className="field">
              <span className="field-label">Block somebody</span>
              <div className="action-field">
                <input className="text-field" placeholder="Address or server to block" value={toBlock} onChange={(e) => setToBlock(e.target.value)} />
                <button type="button" className="button primary" disabled={!toBlock.trim()} onClick={() => void call('xmppBlock', { jid: toBlock.trim(), block: true, report: report ? 'spam' : '' }).then(() => { setBlocked([...blocked, toBlock.trim()]); setToBlock('') }).catch(say)}>
                  Block
                </button>
              </div>
            </label>
            <SwitchRow title="Report as spam" description="Tells the server why, where it takes reports" checked={report} onChange={setReport} />
          </div>
          <div className="card tool-list">
            {blocked.map((b) => (
              <div key={b} className="setting-row">
                <Icon name="block" size={18} color="var(--warning)" />
                <div className="setting-text ellipsis">{b}</div>
                <button type="button" className="button quiet small" onClick={() => void call('xmppBlock', { jid: b, block: false }).then(() => setBlocked(blocked.filter((x) => x !== b))).catch(say)}>
                  Unblock
                </button>
              </div>
            ))}
            {blocked.length === 0 && <p className="small muted tool-none">Nobody is blocked</p>}
          </div>
        </ToolPane>
      )}

      {section === 'privacy' && (
        <ToolPane title="Privacy lists" desc="Rules the server applies to what reaches this account (XEP-0016). Blocking is the newer way; lists made elsewhere still apply.">
          {privacy ? (
            <>
              <div className="card tool-list">
                {privacy.names.map((n) => (
                  <div key={n} className={listName === n ? 'setting-row chosen' : 'setting-row'}>
                    <button type="button" className="setting-text tool-pick" onClick={() => { setListName(n); void call<{ rules: { rule: PrivacyRule; words: string }[] }>('xmppPrivacyRules', { name: n }).then((r) => setRules(r.rules)).catch(say) }}>
                      <div>{n}</div>
                      <div className="small muted">{[privacy.default === n && 'default', privacy.active === n && 'active here'].filter(Boolean).join(', ') || 'not in use'}</div>
                    </button>
                    <button type="button" className="button quiet small" onClick={() => void call('xmppChoosePrivacyList', { which: 'default', name: privacy.default === n ? '' : n }).then(() => setPrivacy({ ...privacy, default: privacy.default === n ? '' : n })).catch(say)}>
                      {privacy.default === n ? 'Not default' : 'Make default'}
                    </button>
                    <button type="button" className="button quiet small" onClick={() => void call('xmppChoosePrivacyList', { which: 'active', name: privacy.active === n ? '' : n }).then(() => setPrivacy({ ...privacy, active: privacy.active === n ? '' : n })).catch(say)}>
                      {privacy.active === n ? 'Stop here' : 'Use here'}
                    </button>
                    <button type="button" className="button danger-quiet small" onClick={() => void call('xmppSetPrivacyList', { name: n, rules: [] }).then(() => { setPrivacy({ ...privacy, names: privacy.names.filter((x) => x !== n) }); if (listName === n) setListName('') }).catch(say)}>
                      Delete
                    </button>
                  </div>
                ))}
                {privacy.names.length === 0 && <p className="small muted tool-none">No lists</p>}
              </div>
              <div className="card card-fields">
                <label className="field">
                  <span className="field-label">List</span>
                  <input className="text-field" value={listName} placeholder="A new list's name, or pick one above" onChange={(e) => { setListName(e.target.value); setRules([]) }} />
                </label>
                {listName && (
                  <>
                    {rules.map((r, i) => (
                      <div key={`${r.rule.order}-${i}`} className="tool-rule">
                        <span className="small">{r.words}</span>
                        <button type="button" className="button quiet small" onClick={() => { const next = rules.filter((_, j) => j !== i); void call('xmppSetPrivacyList', { name: listName, rules: next.map((x) => x.rule) }).then(() => setRules(next)).catch(say) }}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="field">
                      <span className="field-label">A new rule</span>
                      <div className="tool-rule-new">
                        <select className="text-field" value={newRule.action} onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}>
                          <option value="deny">Deny</option>
                          <option value="allow">Allow</option>
                        </select>
                        <select className="text-field" value={newRule.what[0] ?? ''} onChange={(e) => setNewRule({ ...newRule, what: e.target.value ? [e.target.value] : [] })}>
                          <option value="">everything</option>
                          <option value="message">messages</option>
                          <option value="presence-in">their presence</option>
                          <option value="presence-out">your presence to them</option>
                          <option value="iq">requests</option>
                        </select>
                        <select className="text-field" value={newRule.type} onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}>
                          <option value="jid">address</option>
                          <option value="group">group</option>
                          <option value="subscription">subscription</option>
                          <option value="">everybody</option>
                        </select>
                        {newRule.type && <input className="text-field" value={newRule.value} placeholder={newRule.type === 'subscription' ? 'none, to, from or both' : newRule.type === 'group' ? 'Friends' : 'someone@example.org'} onChange={(e) => setNewRule({ ...newRule, value: e.target.value })} />}
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => {
                            const order = rules.reduce((m, r) => Math.max(m, r.rule.order), 0) + 1
                            const next = [...rules.map((r) => r.rule), { ...newRule, order }]
                            void call('xmppSetPrivacyList', { name: listName, rules: next })
                              .then(() => call<{ rules: { rule: PrivacyRule; words: string }[] }>('xmppPrivacyRules', { name: listName }))
                              .then((r) => { setRules(r.rules); if (!privacy.names.includes(listName)) setPrivacy({ ...privacy, names: [...privacy.names, listName] }) })
                              .catch(say)
                          }}
                        >
                          Add rule
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <Asking />
          )}
        </ToolPane>
      )}

      {section === 'published' && (
        <ToolPane title="Published" desc="What this account publishes on its server (PEP), and who may read each.">
          {nodes ? (
            <div className="card tool-list">
              {nodes.map((n) => (
                <div key={n.node} className="setting-row">
                  <div className="setting-text">
                    <div className="ellipsis" title={n.node}>{n.what || n.node}</div>
                    <div className="small muted">
                      {n.items} item{n.items === 1 ? '' : 's'}
                      {n.usedHere ? ' · moho keeps this one' : ''}
                    </div>
                  </div>
                  <select
                    className="setting-select"
                    value={n.access}
                    onChange={(e) => void call('xmppNodeAccess', { node: n.node, access: e.target.value }).then(() => setNodes(nodes.map((x) => (x.node === n.node ? { ...x, access: e.target.value } : x)))).catch(say)}
                  >
                    {!['open', 'presence', 'roster', 'whitelist'].includes(n.access) && <option value={n.access}>{n.access || 'unknown'}</option>}
                    <option value="open">Anybody</option>
                    <option value="presence">Contacts who see your presence</option>
                    <option value="roster">Some of your contacts</option>
                    <option value="whitelist">Only you</option>
                  </select>
                  <button type="button" className="button quiet small" onClick={() => void call('xmppNodeRemove', { node: n.node, delete: false }).then(() => setNodes(nodes.map((x) => (x.node === n.node ? { ...x, items: 0 } : x)))).catch(say)}>
                    Empty
                  </button>
                  <button
                    type="button"
                    className="button danger-quiet small"
                    title={n.usedHere ? 'moho keeps this one: deleting it takes away what it holds here too' : undefined}
                    onClick={() => {
                      if (n.usedHere && !window.confirm(`moho uses ${n.what || n.node}. Delete it anyway?`)) return
                      void call('xmppNodeRemove', { node: n.node, delete: true }).then(() => setNodes(nodes.filter((x) => x.node !== n.node))).catch(say)
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {nodes.length === 0 && <p className="small muted tool-none">Nothing is published</p>}
            </div>
          ) : (
            <Asking />
          )}
        </ToolPane>
      )}

      {section === 'archive' && (
        <ToolPane title="History" desc="What your server keeps of your conversations, which is what lets you read them on a new device.">
          <div className="card">
            <div className="setting-row">
              <div className="setting-text">
                <div>The server keeps</div>
                <div className="small muted">For every client of this account.</div>
              </div>
              <select className="setting-select" value={keeps} onChange={(e) => void call('xmppSetArchivePrefs', { default: e.target.value, always: [], never: [] }).then(() => setKeeps(e.target.value)).catch(say)}>
                <option value="always">Everything</option>
                <option value="roster">Only conversations with my contacts</option>
                <option value="never">Nothing</option>
              </select>
            </div>
          </div>
        </ToolPane>
      )}

      {section === 'server' && (
        <ToolPane title="Server" desc="What your server is, who runs it, and what it can do.">
          {info ? (
            <div className="card">
              <div className="setting-row">
                <div className="setting-text">
                  <div>{info.software ?? 'Unknown software'} {info.version ?? ''}</div>
                  <div className="small muted">{server}</div>
                </div>
              </div>
              {Object.entries(info.contacts).map(([kind, list]) => (
                <div key={kind} className="setting-row">
                  <div className="setting-text">
                    <div>{kind}</div>
                    <div className="small muted selectable">{list.join(', ')}</div>
                  </div>
                </div>
              ))}
              <details className="tool-details">
                <summary>What it can do ({info.features.length})</summary>
                <ul className="plain-list small">
                  {info.features.map((f) => (
                    <li key={f.var}>{f.xep ? `${f.xep} (${f.var})` : f.var}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <Asking />
          )}
        </ToolPane>
      )}

      {section === 'commands' && (
        <ToolPane title="Commands" desc="What the server lets this account run on it (ad-hoc commands): an administrator sees more here than anybody else.">
          {step ? (
            <div className="card card-fields">
              {step.notes.map(([kind, text], i) => (
                <p key={i} className={kind === 'error' ? 'warning-note' : 'small muted'}>
                  {text}
                </p>
              ))}
              {step.form && step.status === 'executing' && (
                <XmppDataForm
                  form={step.form}
                  submitLabel={step.actions.includes('next') ? 'Next' : 'Done'}
                  onSubmit={(answers) => run(node, step.actions.includes('next') ? 'next' : 'complete', answers)}
                  onCancel={() => {
                    run(node, 'cancel')
                    setStep(null)
                  }}
                />
              )}
              {step.form && step.status !== 'executing' && (
                <ul className="plain-list small">
                  {step.form.fields.map((f) => (
                    <li key={f.var}>
                      {f.label || f.var}: {f.values.join(', ')}
                    </li>
                  ))}
                </ul>
              )}
              {step.status !== 'executing' && (
                <div className="tool-actions">
                  <button type="button" className="button quiet" onClick={() => setStep(null)}>
                    Back to the list
                  </button>
                </div>
              )}
            </div>
          ) : commands ? (
            <div className="card tool-list">
              {commands.map((c) => (
                <div key={c.node} className="setting-row">
                  <div className="setting-text ellipsis">{c.name}</div>
                  <button type="button" className="button quiet small" onClick={() => run(c.node)}>
                    Run
                  </button>
                </div>
              ))}
              {commands.length === 0 && <p className="small muted tool-none">The server offers this account no commands</p>}
            </div>
          ) : (
            <Asking />
          )}
        </ToolPane>
      )}

      {section === 'connection' && (
        <ToolPane title="Connection settings" desc="How the account reaches its server. Saving makes it connect again with what was changed.">
          <div className="card">
            <XmppConnectionSettings account={account} always />
          </div>
        </ToolPane>
      )}

      {section === 'delete' && (
        <ToolPane title="Delete the account" desc={`Removes the account from ${server || 'the server'} itself, not only from moho.`}>
          <div className="card card-fields danger-zone">
            <p className="warning-note">
              <Icon name="warning" size={16} /> This removes the account from {server || 'the server'}, with its contacts and its archive. It cannot be undone. Type the address to confirm.
            </p>
            <div className="action-field">
              <input className="text-field" value={typed} placeholder={account.displayName} onChange={(e) => setTyped(e.target.value)} />
              <button
                type="button"
                className="button danger"
                disabled={typed.trim() !== account.id.replace(/^xmpp:/, '')}
                onClick={() =>
                  void call('xmppDeleteAccount')
                    .then(() => window.moho.rpc('removeAccount', { accountId: account.id }))
                    .then(() => store.refreshAccounts())
                    .catch(say)
                }
              >
                Delete the account
              </button>
            </div>
          </div>
        </ToolPane>
      )}
    </SideTabs>
  )
}

/** The server part of an XMPP account's id. */
function accountServer(id: string): string {
  return id.includes('@') ? id.slice(id.lastIndexOf('@') + 1) : ''
}

function XmppStoppedTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [cert, setCert] = useState<{ sha256?: string; refused?: string; details?: CertDetails | null; pinned?: CertDetails | null; changed?: string[] } | null>(null)
  const [password, setPassword] = useState('')
  const stopped = account.state === 'auth_failed'

  useEffect(() => {
    if (!stopped) {
      setCert(null)
      return
    }
    void window.moho
      .rpc<{ sha256?: string; refused?: string; details?: CertDetails | null; pinned?: CertDetails | null; changed?: string[] }>('getXmppCertificate', { accountId: account.id })
      .then(setCert)
      .catch(() => setCert(null))
  }, [account.id, stopped])

  if (!stopped) return null

  const trust = (): void => {
    if (!cert?.sha256) return
    void window.moho
      .rpc('trustXmppCertificate', { accountId: account.id, sha256: cert.sha256 })
      .then(() => {
        setCert(null)
        void store.refreshAccounts()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }
  const change = (): void => {
    void window.moho
      .rpc('setXmppPassword', { accountId: account.id, password })
      .then(() => {
        setPassword('')
        void store.refreshAccounts()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="account-tools">
      {cert?.sha256 ? (
        <div className="warning-note">
          <Icon name="warning" size={16} />
          <div>
            {cert.pinned ? (
              <p>
                The server showed a <strong>different certificate</strong> from the one trusted for this account{cert.refused ? ` (${cert.refused})` : ''}. A
                server renewing its certificate does this; so does somebody in the middle. What is different:
              </p>
            ) : (
              <p>
                The server showed a certificate moho does not trust{cert.refused ? ` (${cert.refused})` : ''}. Compare this fingerprint with the one your
                server publishes before trusting it:
              </p>
            )}
            {cert.pinned && (
              <ul className="small">
                {(cert.changed?.length ? cert.changed : ['nothing that is shown here, only the key itself']).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {cert.details && <CertificateFacts details={cert.details} />}
            <p className="mono small">{cert.sha256.match(/.{2}/g)?.join(':')}</p>
            <button type="button" className="button" onClick={trust}>
              Trust this certificate
            </button>
          </div>
        </div>
      ) : (
        <div className="field-row">
          <label className="field">
            <span className="small muted">New password</span>
            <input
              className="text-field"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) change()
              }}
            />
          </label>
          <button type="button" className="button" disabled={!password} onClick={change}>
            Sign in again
          </button>
        </div>
      )}
    </div>
  )
}

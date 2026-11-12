import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { XmppDataForm, type XmppForm } from './XmppDataForm'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/**
 * What the account's card offers when the server will not let it in: the certificate it showed, to be looked at and
 * trusted or not, and a new password for one it refused.
 */
export function XmppAccountTools({ account }: { account: Account }): JSX.Element | null {
  return (
    <>
      {account.state === 'connected' ? <XmppConnectedTools account={account} /> : <XmppStoppedTools account={account} />}
      <XmppConnectionSettings account={account} />
    </>
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
function XmppConnectionSettings({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
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
      <button type="button" className="button subtle small" onClick={() => setOpen(!open)}>
        {open ? 'Hide connection settings' : 'Connection settings'}
      </button>
      {open && s && (
        <div className="add-form">
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
  const [section, setSection] = useState<'' | 'profile' | 'invite' | 'published' | 'privacy' | 'picture' | 'password' | 'blocked' | 'archive' | 'server' | 'commands' | 'delete'>('')
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
  const tab = (id: typeof section, label: string): JSX.Element => (
    <button type="button" className={section === id ? 'active' : undefined} onClick={() => setSection(section === id ? '' : id)}>
      {label}
    </button>
  )
  return (
    <div className="account-tools">
      <div className="segmented">
        {tab('profile', 'Profile')}
        {tab('invite', 'Invite')}
        {tab('published', 'Published')}
        {tab('privacy', 'Privacy lists')}
        {tab('picture', 'Picture')}
        {tab('password', 'Password')}
        {tab('blocked', 'Blocked')}
        {tab('archive', 'History')}
        {tab('server', 'Server')}
        {tab('commands', 'Commands')}
        {tab('delete', 'Delete')}
      </div>
      {section === 'published' && nodes && (
        <div className="add-form">
          <p className="small muted">What this account publishes on its server (PEP), and who may read each.</p>
          <ul className="plain-list">
            {nodes.map((n) => (
              <li key={n.node} className="field-row">
                <span className="ellipsis" title={n.node}>
                  {n.what || n.node} <span className="small muted">· {n.items} item{n.items === 1 ? '' : 's'}</span>
                </span>
                <select
                  className="text-field"
                  value={n.access}
                  onChange={(e) => void call('xmppNodeAccess', { node: n.node, access: e.target.value }).then(() => setNodes(nodes.map((x) => (x.node === n.node ? { ...x, access: e.target.value } : x)))).catch(say)}
                >
                  {!['open', 'presence', 'roster', 'whitelist'].includes(n.access) && <option value={n.access}>{n.access || 'unknown'}</option>}
                  <option value="open">Anybody</option>
                  <option value="presence">Contacts who see your presence</option>
                  <option value="roster">Some of your contacts</option>
                  <option value="whitelist">Only you</option>
                </select>
                <button type="button" className="button subtle small" onClick={() => void call('xmppNodeRemove', { node: n.node, delete: false }).then(() => setNodes(nodes.map((x) => (x.node === n.node ? { ...x, items: 0 } : x)))).catch(say)}>
                  Empty
                </button>
                <button
                  type="button"
                  className="button subtle small"
                  title={n.usedHere ? 'moho keeps this one: deleting it takes away what it holds here too' : undefined}
                  onClick={() => {
                    if (n.usedHere && !window.confirm(`moho uses ${n.what || n.node}. Delete it anyway?`)) return
                    void call('xmppNodeRemove', { node: n.node, delete: true }).then(() => setNodes(nodes.filter((x) => x.node !== n.node))).catch(say)
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
            {nodes.length === 0 && <li className="small muted">Nothing is published</li>}
          </ul>
        </div>
      )}
      {section === 'privacy' && privacy && (
        <div className="add-form">
          <p className="small muted">Privacy lists (XEP-0016): rules the server applies to what reaches this account. Blocking (the Blocked tab) is the newer way; lists made elsewhere still apply.</p>
          <ul className="plain-list">
            {privacy.names.map((n) => (
              <li key={n} className="field-row">
                <button type="button" className={listName === n ? 'button small' : 'button subtle small'} onClick={() => { setListName(n); void call<{ rules: { rule: PrivacyRule; words: string }[] }>('xmppPrivacyRules', { name: n }).then((r) => setRules(r.rules)).catch(say) }}>
                  {n}
                </button>
                <span className="small muted">{[privacy.default === n && 'default', privacy.active === n && 'active here'].filter(Boolean).join(', ')}</span>
                <button type="button" className="button subtle small" onClick={() => void call('xmppChoosePrivacyList', { which: 'default', name: privacy.default === n ? '' : n }).then(() => setPrivacy({ ...privacy, default: privacy.default === n ? '' : n })).catch(say)}>
                  {privacy.default === n ? 'Not default' : 'Make default'}
                </button>
                <button type="button" className="button subtle small" onClick={() => void call('xmppChoosePrivacyList', { which: 'active', name: privacy.active === n ? '' : n }).then(() => setPrivacy({ ...privacy, active: privacy.active === n ? '' : n })).catch(say)}>
                  {privacy.active === n ? 'Stop here' : 'Use here'}
                </button>
                <button type="button" className="button subtle small" onClick={() => void call('xmppSetPrivacyList', { name: n, rules: [] }).then(() => { setPrivacy({ ...privacy, names: privacy.names.filter((x) => x !== n) }); if (listName === n) setListName('') }).catch(say)}>
                  Delete
                </button>
              </li>
            ))}
            {privacy.names.length === 0 && <li className="small muted">No lists</li>}
          </ul>
          <label className="field">
            <span className="small muted">List</span>
            <input className="text-field" value={listName} placeholder="A new list's name" onChange={(e) => { setListName(e.target.value); setRules([]) }} />
          </label>
          {listName && (
            <>
              <ul className="plain-list">
                {rules.map((r, i) => (
                  <li key={`${r.rule.order}-${i}`} className="field-row">
                    <span className="small">{r.words}</span>
                    <button type="button" className="button subtle small" onClick={() => { const next = rules.filter((_, j) => j !== i); void call('xmppSetPrivacyList', { name: listName, rules: next.map((x) => x.rule) }).then(() => setRules(next)).catch(say) }}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="field-row">
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
                  className="button small"
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
            </>
          )}
        </div>
      )}
      {section === 'invite' && inviteKinds && (
        <div className="add-form">
          {inviteKinds.length === 0 && <p className="small muted">This server does not make invitations (XEP-0401).</p>}
          <div className="field-row">
            {inviteKinds.includes('contact') && (
              <button type="button" className="button" onClick={() => void call<{ uri: string; landingUrl: string; expires: string }>('xmppCreateInvite', { kind: 'contact' }).then(setInvite).catch(say)}>
                Invite somebody to be a contact
              </button>
            )}
            {inviteKinds.includes('account') && (
              <button type="button" className="button" onClick={() => void call<{ uri: string; landingUrl: string; expires: string }>('xmppCreateInvite', { kind: 'account' }).then(setInvite).catch(say)}>
                Invite somebody to make an account here
              </button>
            )}
          </div>
          {invite && (
            <div className="add-form">
              <p className="small muted">Send them this. Opened in an XMPP client, it adds you as a contact without the request waiting for an answer{invite.expires ? `; it works until ${new Date(invite.expires).toLocaleString()}` : ''}.</p>
              {[invite.landingUrl, invite.uri].filter(Boolean).map((link) => (
                <div key={link} className="field-row">
                  <input className="text-field mono" readOnly value={link} onFocus={(e) => e.target.select()} />
                  <button type="button" className="button small" onClick={() => void navigator.clipboard.writeText(link).then(() => store.toast('info', 'Copied'))}>
                    Copy
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {section === 'profile' && me && (
        <div className="add-form">
          <p className="small muted">What others see when they look at this account (its vCard and nickname). Anybody can read the vCard; the nickname is for contacts.</p>
          {(
            [
              ['fullName', 'Name'],
              ['nickname', 'Nickname'],
              ['email', 'E-mail'],
              ['url', 'Website']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field">
              <span className="small muted">{label}</span>
              <input className="text-field" autoComplete="off" value={me[key]} onChange={(e) => setMe({ ...me, [key]: e.target.value })} />
            </label>
          ))}
          <label className="field">
            <span className="small muted">About</span>
            <textarea className="text-field" rows={3} value={me.note} onChange={(e) => setMe({ ...me, note: e.target.value })} />
          </label>
          <div className="field-row">
            <button type="button" className="button primary" onClick={() => void call('xmppSetProfile', me).then(() => store.toast('info', 'Profile published')).catch(say)}>
              Publish
            </button>
          </div>
        </div>
      )}
      {section === 'picture' && (
        <div className="field-row">
          <button
            type="button"
            className="button"
            onClick={() =>
              void window.moho.pickFile().then((path) => {
                if (path) void call('xmppSetAvatar', { path }).then(() => store.toast('info', 'Picture changed')).catch(say)
              })
            }
          >
            Choose a picture…
          </button>
          <button type="button" className="button subtle" onClick={() => void call('xmppSetAvatar', { path: '' }).then(() => store.toast('info', 'Picture taken off')).catch(say)}>
            Take it off
          </button>
        </div>
      )}
      {section === 'password' && (
        <div className="field-row">
          <input className="text-field" type="password" autoComplete="off" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button
            type="button"
            className="button"
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
      )}
      {section === 'blocked' && (
        <div className="add-form">
          <ul className="plain-list">
            {blocked.map((b) => (
              <li key={b} className="field-row">
                <span className="ellipsis">{b}</span>
                <button type="button" className="button small" onClick={() => void call('xmppBlock', { jid: b, block: false }).then(() => setBlocked(blocked.filter((x) => x !== b))).catch(say)}>
                  Unblock
                </button>
              </li>
            ))}
            {blocked.length === 0 && <li className="small muted">Nobody is blocked</li>}
          </ul>
          <div className="field-row">
            <input className="text-field" placeholder="Address or server to block" value={toBlock} onChange={(e) => setToBlock(e.target.value)} />
            <label className="check-row">
              <input type="checkbox" checked={report} onChange={(e) => setReport(e.target.checked)} />
              <span>Report as spam</span>
            </label>
            <button type="button" className="button" disabled={!toBlock.trim()} onClick={() => void call('xmppBlock', { jid: toBlock.trim(), block: true, report: report ? 'spam' : '' }).then(() => { setBlocked([...blocked, toBlock.trim()]); setToBlock('') }).catch(say)}>
              Block
            </button>
          </div>
        </div>
      )}
      {section === 'archive' && (
        <div className="add-form">
          <p className="small muted">What your server keeps of your conversations, which is what lets you read them on a new device.</p>
          <select className="text-field" value={keeps} onChange={(e) => void call('xmppSetArchivePrefs', { default: e.target.value, always: [], never: [] }).then(() => setKeeps(e.target.value)).catch(say)}>
            <option value="always">Everything</option>
            <option value="roster">Only conversations with people on my contact list</option>
            <option value="never">Nothing</option>
          </select>
        </div>
      )}
      {section === 'server' &&
        (info ? (
          <div className="add-form">
            <p>
              {info.software ?? 'Unknown software'} {info.version ?? ''}
            </p>
            {Object.entries(info.contacts).map(([kind, list]) => (
              <p key={kind} className="small muted">
                {kind}: {list.join(', ')}
              </p>
            ))}
            <details>
              <summary className="small muted">What it can do ({info.features.length})</summary>
              <ul className="plain-list small">
                {info.features.map((f) => (
                  <li key={f.var}>{f.xep ? `${f.xep} (${f.var})` : f.var}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : (
          <p className="small muted">Asking the server…</p>
        ))}
      {section === 'commands' && (
        <div className="add-form">
          {step ? (
            <>
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
                <button type="button" className="button" onClick={() => setStep(null)}>
                  Back to the list
                </button>
              )}
            </>
          ) : commands ? (
            <>
              <ul className="plain-list">
                {commands.map((c) => (
                  <li key={c.node} className="field-row">
                    <span className="ellipsis">{c.name}</span>
                    <button type="button" className="button small" onClick={() => run(c.node)}>
                      Run
                    </button>
                  </li>
                ))}
                {commands.length === 0 && <li className="small muted">The server offers this account no commands</li>}
              </ul>
            </>
          ) : (
            <p className="small muted">Asking the server…</p>
          )}
        </div>
      )}
      {section === 'delete' && (
        <div className="add-form">
          <p className="warning-note">
            <Icon name="warning" size={16} /> This removes the account from {account.displayName.split('@')[1] ?? 'the server'}, with its contacts and its archive. It cannot be undone. Type the address to confirm.
          </p>
          <div className="field-row">
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
      )}
    </div>
  )
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

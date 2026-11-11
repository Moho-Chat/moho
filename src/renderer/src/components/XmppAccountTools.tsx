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
  if (account.state === 'connected') return <XmppConnectedTools account={account} />
  return <XmppStoppedTools account={account} />
}

interface ServerInfo {
  software?: string | null
  version?: string | null
  contacts: Record<string, string[]>
  features: { var: string; xep?: string | null }[]
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
  const [section, setSection] = useState<'' | 'picture' | 'password' | 'blocked' | 'archive' | 'server' | 'commands' | 'delete'>('')
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
        {tab('picture', 'Picture')}
        {tab('password', 'Password')}
        {tab('blocked', 'Blocked')}
        {tab('archive', 'History')}
        {tab('server', 'Server')}
        {tab('commands', 'Commands')}
        {tab('delete', 'Delete')}
      </div>
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
  const [cert, setCert] = useState<{ sha256?: string; refused?: string } | null>(null)
  const [password, setPassword] = useState('')
  const stopped = account.state === 'auth_failed'

  useEffect(() => {
    if (!stopped) {
      setCert(null)
      return
    }
    void window.moho
      .rpc<{ sha256?: string; refused?: string }>('getXmppCertificate', { accountId: account.id })
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
            <p>
              The server showed a certificate moho does not trust{cert.refused ? ` (${cert.refused})` : ''}. Compare this fingerprint with the one your
              server publishes before trusting it:
            </p>
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

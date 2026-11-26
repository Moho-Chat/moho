import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { Switch, SwitchRow } from './Switch'
import { ConfirmButton } from './ConfirmButton'
import { useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'

/**
 * Asks the daemon; or, in a window the screenshot harness started, takes the answer it left in `__rpcFixture`, since
 * the harness has no Stoat to ask.
 */
/** Whose server this is, for the words that name the service: the same window serves Stoat's servers and Fluxer's communities. */
function serviceName(bufferId: string): string {
  return bufferId.startsWith('fluxer:') ? 'Fluxer' : 'Stoat'
}

function ask<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __mohoShots?: unknown; __rpcFixture?: Record<string, (p: Record<string, unknown>) => unknown> }
  const stub = w.__mohoShots ? w.__rpcFixture?.[method] : undefined
  return stub ? Promise.resolve(stub(params) as T) : window.moho.rpc<T>(method, params)
}

interface Permission {
  key: string
  label: string
  group: string
  /** Means something in one channel, not only server-wide. */
  channel: boolean
}
interface Category {
  id: string
  title: string
  channels: string[]
}
interface Override {
  allow: string[]
  deny: string[]
}
interface Channel {
  id: string
  name: string
  description: string
  voice: boolean
  nsfw: boolean
  slowmode: number
  category: string | null
  roles: ({ roleId: string } & Override)[]
  default: Override
}
interface Role extends Override {
  id: string
  name: string
  colour?: string | null
  hoist: boolean
  rank: number
}
interface Overview {
  serverId: string
  name: string
  description: string
  iconUrl?: string | null
  can: { owner: boolean; server: boolean; channels: boolean; roles: boolean; permissions: boolean; webhooks: boolean; audit: boolean }
  categories: Category[]
  channels: Channel[]
  roles: Role[]
  defaultPermissions: string[]
  permissions: Permission[]
  limits: { channels: number; roles: number }
}
interface Webhook {
  id: string
  name: string
  token?: string | null
  url?: string | null
}
interface Invite {
  code: string
  link: string
  channel: string
  by: string
  uses?: number | null
  maxUses?: number | null
  maxAge?: number | null
  createdAt?: string | null
}
interface AuditEntry {
  id: string
  text: string
  ts: number
}

type Tab = 'overview' | 'channels' | 'roles' | 'invites' | 'bans' | 'webhooks' | 'audit'
type Act = <T>(action: string, extra?: Record<string, unknown>) => Promise<T | undefined>
type Stance = 'inherit' | 'allow' | 'deny'

const SLOWMODES: [number, string][] = [
  [0, 'Off'],
  [5, '5 seconds'],
  [10, '10 seconds'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [300, '5 minutes'],
  [900, '15 minutes'],
  [3600, '1 hour'],
  [21600, '6 hours']
]

/**
 * Looking after a Stoat server: its name and picture, channels and the headings they sit under, roles and what each may
 * do, who may do what in one channel, webhooks, and what moderators did.
 *
 * Read from the daemon each time it is opened and after every change, so what is shown is what Stoat holds. What the
 * account may not change is not offered; Stoat checks again and refuses in words if it was wrong about that.
 */
export function StoatServerSettings({ bufferId, onClose }: { bufferId: string; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [server, setServer] = useState<Overview | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setServer(await ask<Overview>('stoatManage', { bufferId, action: 'overview' }))
  }, [bufferId])
  useEffect(() => {
    void reload().catch((e: Error) => {
      store.toast('error', e.message)
      onClose()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  /** One change, then the server read again; the error is Stoat's own. */
  const act: Act = useCallback(
    async <T,>(action: string, extra: Record<string, unknown> = {}): Promise<T | undefined> => {
      setBusy(true)
      try {
        const done = await ask<T>('stoatManage', { bufferId, action, ...extra })
        if (action !== 'webhooks' && action !== 'auditLog' && action !== 'invites' && action !== 'bans') await reload()
        return done
      } catch (e) {
        store.toast('error', (e as Error).message)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [bufferId, reload, store]
  )

  if (!server) {
    return (
      <Modal title="Server" icon="dns" onClose={onClose} className="steam-group stoat-server">
        <p className="small muted">
          <span className="spinner" /> Asking {serviceName(bufferId)}…
        </p>
      </Modal>
    )
  }
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['channels', 'Channels'],
    ['roles', 'Roles'],
    ...(bufferId.startsWith('fluxer:') ? ([['invites', 'Invites'], ['bans', 'Bans']] as [Tab, string][]) : []),
    ['webhooks', 'Webhooks'],
    ['audit', 'Audit log']
  ]
  return (
    <Modal title={server.name || 'Server'} icon="dns" onClose={onClose} className="steam-group stoat-server">
      <div className="room-settings-tabs" role="tablist">
        {tabs
          .filter(([id]) => id !== 'audit' || server.can.audit)
          .map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`room-settings-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
      </div>
      <div className="room-settings-body steam-group-body">
        {tab === 'overview' && <Overview server={server} busy={busy} act={act} fluxer={bufferId.startsWith('fluxer:')} />}
        {tab === 'overview' && bufferId.startsWith('fluxer:') && server.can.owner && <DeleteCommunity bufferId={bufferId} server={server} onDone={onClose} />}
        {tab === 'invites' && <Invites bufferId={bufferId} server={server} busy={busy} act={act} />}
        {tab === 'bans' && <Bans bufferId={bufferId} act={act} />}
        {tab === 'channels' && <Channels server={server} busy={busy} act={act} />}
        {tab === 'roles' && <Roles server={server} busy={busy} act={act} />}
        {tab === 'webhooks' && <Webhooks server={server} busy={busy} act={act} />}
        {tab === 'audit' && <Audit act={act} />}
      </div>
    </Modal>
  )
}

function Overview({ server, busy, act, fluxer }: { server: Overview; busy: boolean; act: Act; fluxer: boolean }): JSX.Element {
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description)
  const may = server.can.server
  return (
    <>
      <div className="field">
        <span className="small muted">Picture</span>
        <div className="field-row steam-group-row">
          {server.iconUrl ? <img className="account-avatar" src={resolveMediaUrl(server.iconUrl)} alt="" /> : <Icon name="dns" size={18} />}
          <span className="grow small muted">{may ? 'Shown on the rail.' : `Only those who may manage the ${fluxer ? 'community' : 'server'} can change it.`}</span>
          <button type="button" className="button subtle small" disabled={!may || busy} onClick={() => void window.moho.pickFile(['jpg', 'jpeg', 'png', 'gif', 'webp']).then((path) => path && void act('editServer', { icon: path }))}>
            Change picture
          </button>
          {server.iconUrl && (
            <button type="button" className="button subtle small" disabled={!may || busy} onClick={() => void act('editServer', { icon: '' })}>
              Take it off
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <span className="small muted">Name</span>
        <div className="field-row">
          <input className="text-field" value={name} disabled={!may || busy} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="button" disabled={!may || busy || !name.trim() || name === server.name} onClick={() => void act('editServer', { name })}>
            Save
          </button>
        </div>
      </div>
      {/* A Fluxer community has no description to set; its PATCH quietly ignores one. */}
      {!fluxer && <div className="field">
        <span className="small muted">Description</span>
        <textarea className="text-field" rows={3} value={description} disabled={!may || busy} onChange={(e) => setDescription(e.target.value)} />
        <div className="field-row">
          <button type="button" className="button" disabled={!may || busy || description === server.description} onClick={() => void act('editServer', { description })}>
            Save
          </button>
        </div>
      </div>}
      <p className="small muted">
        {server.can.owner ? `You own this ${fluxer ? 'community' : 'server'}.` : 'What is offered here is what your roles allow.'} {server.channels.length} of at most {server.limits.channels} channels, {server.roles.length} of at most {server.limits.roles} roles.
      </p>
    </>
  )
}

/** What a set of allows and denies says about one permission. */
function stanceOf(o: Override, key: string): Stance {
  return o.allow.includes(key) ? 'allow' : o.deny.includes(key) ? 'deny' : 'inherit'
}

/**
 * Every permission with its choice: inherit what is below, allow, or deny. Grouped as Stoat's own app groups them.
 * `onlyAllow` is for the server's default, which can only grant.
 */
function PermissionEditor({
  permissions,
  value,
  onChange,
  channel,
  onlyAllow,
  disabled
}: {
  permissions: Permission[]
  value: Override
  onChange: (next: Override) => void
  channel: boolean
  onlyAllow?: boolean
  disabled?: boolean
}): JSX.Element {
  const shown = permissions.filter((p) => !channel || p.channel)
  const groups = [...new Set(shown.map((p) => p.group))]
  const set = (key: string, stance: Stance): void => {
    const allow = value.allow.filter((k) => k !== key)
    const deny = value.deny.filter((k) => k !== key)
    if (stance === 'allow') allow.push(key)
    if (stance === 'deny') deny.push(key)
    onChange({ allow, deny })
  }
  return (
    <div className="steam-group-perms">
      {groups.map((g) => (
        <div key={g} className="field">
          <span className="small muted">{g}</span>
          {shown
            .filter((p) => p.group === g)
            .map((p) => (
              <div key={p.key} className="field-row steam-group-row">
                <span className="grow ellipsis">{p.label}</span>
                <select className="text-field small" aria-label={p.label} disabled={disabled} value={stanceOf(value, p.key)} onChange={(e) => set(p.key, e.target.value as Stance)}>
                  <option value="inherit">{onlyAllow ? 'No' : 'Inherit'}</option>
                  <option value="allow">Allow</option>
                  {!onlyAllow && <option value="deny">Deny</option>}
                </select>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

function Channels({ server, busy, act }: { server: Overview; busy: boolean; act: Act }): JSX.Element {
  const [open, setOpen] = useState<{ id: string; what: 'edit' | 'permissions' } | null>(null)
  const [fresh, setFresh] = useState('')
  const [voice, setVoice] = useState(false)
  const [heading, setHeading] = useState('')
  const may = server.can.channels
  const byId = useMemo(() => new Map(server.channels.map((c) => [c.id, c])), [server.channels])

  const sections: { id: string | null; title: string; channels: Channel[] }[] = [
    ...server.categories.map((c) => ({ id: c.id as string | null, title: c.title, channels: c.channels.map((x) => byId.get(x)).filter((x): x is Channel => !!x) })),
    { id: null, title: server.categories.length ? 'No heading' : 'Channels', channels: server.channels.filter((c) => !c.category) }
  ]
  const write = (next: Category[]): void => void act('setCategories', { categories: next })
  /** The headings with one channel moved under another (or, with `to` null, out of them all). */
  const moved = (channel: string, to: string | null): Category[] => server.categories.map((c) => ({ ...c, channels: [...c.channels.filter((x) => x !== channel), ...(c.id === to ? [channel] : [])] }))
  const shifted = (category: Category, channel: string, by: number): Category[] =>
    server.categories.map((c) => {
      if (c.id !== category.id) return c
      const list = [...c.channels]
      const at = list.indexOf(channel)
      const to = at + by
      if (at < 0 || to < 0 || to >= list.length) return c
      ;[list[at], list[to]] = [list[to], list[at]]
      return { ...c, channels: list }
    })

  return (
    <>
      {sections.map((s) => (
        <div key={s.id ?? 'none'} className="field">
          <div className="field-row steam-group-row">
            <span className="grow small muted">{s.title}</span>
            {may && s.id && <HeadingTools category={server.categories.find((c) => c.id === s.id)!} categories={server.categories} write={write} busy={busy} />}
          </div>
          {s.channels.map((c) => {
            const category = server.categories.find((x) => x.id === c.category)
            return (
              <div key={c.id} className="steam-group-person">
                <div className="field-row steam-group-row">
                  <Icon name={c.voice ? 'volume_up' : 'tag'} size={16} />
                  <span className="grow ellipsis">{c.name}</span>
                  {c.nsfw && <span className="small muted">18+</span>}
                  {c.slowmode > 0 && <span className="small muted">slow {SLOWMODES.find(([s]) => s === c.slowmode)?.[1] ?? `${c.slowmode}s`}</span>}
                  {may && category && (
                    <>
                      <button type="button" className="button subtle small" aria-label={`Move ${c.name} up`} disabled={busy} onClick={() => write(shifted(category, c.id, -1))}>
                        ↑
                      </button>
                      <button type="button" className="button subtle small" aria-label={`Move ${c.name} down`} disabled={busy} onClick={() => write(shifted(category, c.id, 1))}>
                        ↓
                      </button>
                    </>
                  )}
                  {may && (
                    <button type="button" className="button subtle small" onClick={() => setOpen(open?.id === c.id && open.what === 'edit' ? null : { id: c.id, what: 'edit' })}>
                      Edit
                    </button>
                  )}
                  {server.can.permissions && (
                    <button type="button" className="button subtle small" onClick={() => setOpen(open?.id === c.id && open.what === 'permissions' ? null : { id: c.id, what: 'permissions' })}>
                      Who may
                    </button>
                  )}
                  {may && <ConfirmButton label="Delete" question={`Delete ${c.name} and what was said in it?`} confirmLabel="Delete" danger onConfirm={() => void act('deleteChannel', { channelId: c.id })} />}
                </div>
                {open?.id === c.id && open.what === 'edit' && <ChannelEdit channel={c} categories={server.categories} busy={busy} act={act} onMove={(to) => write(moved(c.id, to))} />}
                {open?.id === c.id && open.what === 'permissions' && <ChannelPermissions channel={c} server={server} busy={busy} act={act} />}
              </div>
            )
          })}
        </div>
      ))}
      {may && (
        <>
          <div className="field-row">
            <input className="text-field" placeholder="A new channel" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fresh.trim() && void act('createChannel', { name: fresh, voice }).then(() => setFresh(''))} />
            <button type="button" className="button" disabled={busy || !fresh.trim()} onClick={() => void act('createChannel', { name: fresh, voice }).then(() => setFresh(''))}>
              Add channel
            </button>
          </div>
          <SwitchRow title="A voice channel" description="People in it can talk, as well as write" checked={voice} onChange={setVoice} />
          <div className="field-row">
            <input className="text-field" placeholder="A new heading" maxLength={32} value={heading} onChange={(e) => setHeading(e.target.value)} />
            <button
              type="button"
              className="button"
              disabled={busy || !heading.trim()}
              onClick={() => {
                write([...server.categories, { id: Math.random().toString(36).slice(2, 10).toUpperCase(), title: heading.trim(), channels: [] }])
                setHeading('')
              }}
            >
              Add heading
            </button>
          </div>
        </>
      )}
    </>
  )
}

/** Renaming a heading, moving it, and taking it away (its channels stay, under no heading). */
function HeadingTools({ category, categories, write, busy }: { category: Category; categories: Category[]; write: (next: Category[]) => void; busy: boolean }): JSX.Element {
  const [name, setName] = useState<string | null>(null)
  const at = categories.findIndex((c) => c.id === category.id)
  const swap = (by: number): Category[] => {
    const list = [...categories]
    ;[list[at], list[at + by]] = [list[at + by], list[at]]
    return list
  }
  if (name !== null) {
    return (
      <>
        <input className="text-field small" autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="button small"
          disabled={busy || !name.trim()}
          onClick={() => {
            write(categories.map((c) => (c.id === category.id ? { ...c, title: name.trim() } : c)))
            setName(null)
          }}
        >
          Save
        </button>
        <button type="button" className="button subtle small" onClick={() => setName(null)}>
          Cancel
        </button>
      </>
    )
  }
  return (
    <>
      <button type="button" className="button subtle small" aria-label={`Move ${category.title} up`} disabled={busy || at === 0} onClick={() => write(swap(-1))}>
        ↑
      </button>
      <button type="button" className="button subtle small" aria-label={`Move ${category.title} down`} disabled={busy || at === categories.length - 1} onClick={() => write(swap(1))}>
        ↓
      </button>
      <button type="button" className="button subtle small" onClick={() => setName(category.title)}>
        Rename
      </button>
      <ConfirmButton label="Remove" question={`Remove the heading ${category.title}? Its channels stay.`} confirmLabel="Remove" danger onConfirm={() => write(categories.filter((c) => c.id !== category.id))} />
    </>
  )
}

function ChannelEdit({ channel, categories, busy, act, onMove }: { channel: Channel; categories: Category[]; busy: boolean; act: Act; onMove: (to: string | null) => void }): JSX.Element {
  const [name, setName] = useState(channel.name)
  const [description, setDescription] = useState(channel.description)
  const [nsfw, setNsfw] = useState(channel.nsfw)
  const [slowmode, setSlowmode] = useState(channel.slowmode)
  // Where it goes is saved with the rest: moving it at once redrew it under its new heading and lost what was typed.
  const [under, setUnder] = useState(channel.category ?? '')
  const edited = name !== channel.name || description !== channel.description || nsfw !== channel.nsfw || slowmode !== channel.slowmode
  const moved = under !== (channel.category ?? '')
  const changed = edited || moved
  const save = async (): Promise<void> => {
    if (edited) await act('editChannel', { channelId: channel.id, name, description, nsfw, slowmode: channel.voice ? undefined : slowmode })
    if (moved) onMove(under || null)
  }
  return (
    <div className="steam-group-perms">
      <input className="text-field" aria-label="Name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <input className="text-field" aria-label="Topic" placeholder="Topic" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
      <SwitchRow title="Age-restricted" description="Asks people to confirm they are of age before they look" checked={nsfw} onChange={setNsfw} />
      {!channel.voice && (
        <div className="field-row steam-group-row">
          <span className="grow">Slowmode</span>
          <select className="text-field small" aria-label="Slowmode" value={slowmode} onChange={(e) => setSlowmode(Number(e.target.value))}>
            {SLOWMODES.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {categories.length > 0 && (
        <div className="field-row steam-group-row">
          <span className="grow">Under</span>
          <select className="text-field small" aria-label="Heading" value={under} onChange={(e) => setUnder(e.target.value)}>
            <option value="">No heading</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field-row">
        <button
          type="button"
          className="button"
          disabled={busy || !changed || !name.trim()}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </div>
  )
}

/** Who may do what in one channel: everybody's default, and each role's. */
function ChannelPermissions({ channel, server, busy, act }: { channel: Channel; server: Overview; busy: boolean; act: Act }): JSX.Element {
  const [who, setWho] = useState('')
  const held = who === '' ? channel.default : (channel.roles.find((r) => r.roleId === who) ?? { allow: [], deny: [] })
  const [value, setValue] = useState<Override>({ allow: held.allow, deny: held.deny })
  useEffect(() => setValue({ allow: held.allow, deny: held.deny }), [who, held.allow.join(), held.deny.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="steam-group-perms">
      <div className="field-row steam-group-row">
        <span className="grow">For</span>
        <select className="text-field small" aria-label="For" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everybody</option>
          {server.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <PermissionEditor permissions={server.permissions} value={value} onChange={setValue} channel disabled={busy} />
      <div className="field-row">
        <button type="button" className="button" disabled={busy} onClick={() => void act('setChannelPermissions', { channelId: channel.id, roleId: who, allow: value.allow, deny: value.deny })}>
          Save
        </button>
      </div>
    </div>
  )
}

function Roles({ server, busy, act }: { server: Overview; busy: boolean; act: Act }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [fresh, setFresh] = useState('')
  const may = server.can.roles
  const order = server.roles.map((r) => r.id)
  const shifted = (id: string, by: number): string[] => {
    const list = [...order]
    const at = list.indexOf(id)
    const to = at + by
    if (at < 0 || to < 0 || to >= list.length) return list
    ;[list[at], list[to]] = [list[to], list[at]]
    return list
  }
  return (
    <>
      <p className="small muted">The most powerful role is first. A role can only be given, changed or moved by someone with a role above it.</p>
      <div className="steam-group-person">
        <div className="field-row steam-group-row">
          <Icon name="groups" size={16} />
          <span className="grow ellipsis">Everybody</span>
          {server.can.permissions && (
            <button type="button" className="button subtle small" onClick={() => setOpen(open === '' ? null : '')}>
              What everybody may do
            </button>
          )}
        </div>
        {open === '' && <RoleEditor server={server} role={null} busy={busy} act={act} />}
      </div>
      {server.roles.map((r) => (
        <div key={r.id} className="steam-group-person">
          <div className="field-row steam-group-row">
            <span style={{ width: 12, height: 12, borderRadius: 6, background: r.colour || 'var(--outline-medium)', display: 'inline-block' }} />
            <span className="grow ellipsis">{r.name}</span>
            {r.hoist && <span className="small muted">listed apart</span>}
            {may && (
              <>
                <button type="button" className="button subtle small" aria-label={`Move ${r.name} up`} disabled={busy} onClick={() => void act('reorderRoles', { order: shifted(r.id, -1) })}>
                  ↑
                </button>
                <button type="button" className="button subtle small" aria-label={`Move ${r.name} down`} disabled={busy} onClick={() => void act('reorderRoles', { order: shifted(r.id, 1) })}>
                  ↓
                </button>
              </>
            )}
            {(may || server.can.permissions) && (
              <button type="button" className="button subtle small" onClick={() => setOpen(open === r.id ? null : r.id)}>
                Edit
              </button>
            )}
            {may && <ConfirmButton label="Delete" question={`Delete the role ${r.name}?`} confirmLabel="Delete" danger onConfirm={() => void act('deleteRole', { roleId: r.id })} />}
          </div>
          {open === r.id && <RoleEditor server={server} role={r} busy={busy} act={act} />}
        </div>
      ))}
      {may && (
        <div className="field-row">
          <input className="text-field" placeholder="A new role" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fresh.trim() && void act('createRole', { name: fresh }).then(() => setFresh(''))} />
          <button type="button" className="button" disabled={busy || !fresh.trim()} onClick={() => void act('createRole', { name: fresh }).then(() => setFresh(''))}>
            Add role
          </button>
        </div>
      )}
    </>
  )
}

/** One role's name, colour and what it allows and denies; with no role, what everybody may do. */
function RoleEditor({ server, role, busy, act }: { server: Overview; role: Role | null; busy: boolean; act: Act }): JSX.Element {
  const [name, setName] = useState(role?.name ?? '')
  const [colour, setColour] = useState(role?.colour ?? '')
  const [hoist, setHoist] = useState(role?.hoist ?? false)
  const [value, setValue] = useState<Override>(role ? { allow: role.allow, deny: role.deny } : { allow: server.defaultPermissions, deny: [] })
  const mayLook = role ? server.can.roles : false
  return (
    <div className="steam-group-perms">
      {role && (
        <>
          <input className="text-field" aria-label="Name" value={name} disabled={busy || !mayLook} onChange={(e) => setName(e.target.value)} />
          <div className="field-row steam-group-row">
            <span className="grow">Colour</span>
            <input type="color" aria-label="Colour" value={/^#[0-9a-f]{6}$/i.test(colour) ? colour : '#808080'} disabled={busy || !mayLook} onChange={(e) => setColour(e.target.value)} />
            <button type="button" className="button subtle small" disabled={busy || !mayLook || !colour} onClick={() => setColour('')}>
              None
            </button>
          </div>
          <div className="field-row steam-group-row">
            <span className="grow">Listed apart in the member list</span>
            <Switch checked={hoist} onChange={setHoist} label="Listed apart" disabled={busy || !mayLook} />
          </div>
          <div className="field-row">
            <button
              type="button"
              className="button"
              disabled={busy || !mayLook || !name.trim() || (name === role.name && colour === (role.colour ?? '') && hoist === role.hoist)}
              onClick={() => void act('editRole', { roleId: role.id, name, colour, hoist })}
            >
              Save the role
            </button>
          </div>
        </>
      )}
      <PermissionEditor permissions={server.permissions} value={value} onChange={setValue} channel={false} onlyAllow={!role} disabled={busy || !server.can.permissions} />
      {server.can.permissions && (
        <div className="field-row">
          <button type="button" className="button" disabled={busy} onClick={() => void act('setRolePermissions', { roleId: role?.id ?? '', allow: value.allow, deny: value.deny })}>
            Save what it may do
          </button>
        </div>
      )}
    </div>
  )
}

function Webhooks({ server, busy, act }: { server: Overview; busy: boolean; act: Act }): JSX.Element {
  const store = useStore()
  const text = server.channels.filter((c) => !c.voice)
  const [channel, setChannel] = useState(text[0]?.id ?? '')
  const [list, setList] = useState<Webhook[] | null>(null)
  const [name, setName] = useState('')
  const load = useCallback(() => {
    if (!channel) return
    void act<{ webhooks: Webhook[] }>('webhooks', { channelId: channel }).then((r) => setList(r?.webhooks ?? []))
  }, [channel, act])
  useEffect(load, [load])
  if (!server.can.webhooks) return <p className="small muted">Only someone who may manage webhooks can see these.</p>
  return (
    <>
      <p className="small muted">A webhook lets another program post in a channel. Its address is a secret: whoever has it can speak there.</p>
      <div className="field-row steam-group-row">
        <span className="grow">Channel</span>
        <select className="text-field small" aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {text.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {list === null && <p className="small muted">Asking…</p>}
      {list?.length === 0 && <p className="small muted">None in this channel.</p>}
      {list?.map((w) => (
        <div key={w.id} className="field-row steam-group-row">
          <Icon name="webhook" size={16} />
          <span className="grow ellipsis">{w.name}</span>
          {w.url && (
            <button type="button" className="button subtle small" onClick={() => void window.moho.copyText(w.url!).then(() => store.toast('info', 'Webhook address copied'))}>
              Copy address
            </button>
          )}
          <ConfirmButton label="Delete" question={`Delete the webhook ${w.name}?`} confirmLabel="Delete" danger onConfirm={() => void act('deleteWebhook', { webhookId: w.id, token: w.token ?? '' }).then(load)} />
        </div>
      ))}
      <div className="field-row">
        <input className="text-field" placeholder="A new webhook" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="button"
          disabled={busy || !name.trim() || !channel}
          onClick={() =>
            void act('createWebhook', { channelId: channel, name }).then(() => {
              setName('')
              load()
            })
          }
        >
          Add webhook
        </button>
      </div>
    </>
  )
}

/** How long an invite has left, from when it was made and how long it was made to last. */
function expiry(i: Invite): string {
  if (!i.maxAge) return 'never expires'
  const made = i.createdAt ? Date.parse(i.createdAt) : NaN
  if (Number.isNaN(made)) return `lasts ${Math.round(i.maxAge / 3600)} h`
  const left = made + i.maxAge * 1000 - Date.now()
  if (left <= 0) return 'expired'
  const hours = left / 3600000
  return hours >= 24 ? `${Math.round(hours / 24)} d left` : hours >= 1 ? `${Math.round(hours)} h left` : `${Math.max(1, Math.round(left / 60000))} min left`
}

/** How often an invite has been used, out of how many it may be. */
function used(i: Invite): string {
  const n = i.uses ?? 0
  const times = n === 0 ? 'not used yet' : n === 1 ? 'used once' : `used ${n} times`
  return i.maxUses ? `${times} of ${i.maxUses}` : times
}

/** A Fluxer community's invites: who made each and where it leads, how often it was used, and deleting one. */
function Invites({ bufferId, server, busy, act }: { bufferId: string; server: Overview; busy: boolean; act: Act }): JSX.Element {
  const store = useStore()
  const [list, setList] = useState<Invite[] | null>(null)
  const load = useCallback(() => {
    void act<{ invites: Invite[] }>('invites').then((r) => setList(r?.invites ?? []))
  }, [act])
  useEffect(load, [load])
  const make = (): void => {
    void ask<{ link: string }>('createStoatInvite', { bufferId })
      .then((r) => window.moho.copyText(r.link).then(() => store.toast('info', `Invite made and copied: ${r.link}`)))
      .then(load)
      .catch((e: Error) => store.toast('error', e.message))
  }
  return (
    <>
      <p className="small muted">An invite is a link that lets somebody join. Deleting one stops it working; whoever already joined stays.</p>
      {list === null && <p className="small muted">Asking…</p>}
      {list?.length === 0 && <p className="small muted">{server.can.server ? 'There are no invites.' : 'None you can see: only those who may manage the community see every invite.'}</p>}
      {list?.map((i) => (
        <div key={i.code} className="field-row steam-group-row">
          <Icon name="link" size={16} />
          <span className="grow ellipsis" title={i.link}>
            <span>{i.code}</span>
            <span className="small muted">
              {' '}
              · #{i.channel}
              {i.by ? ` · by ${i.by}` : ''} · {used(i)} · {expiry(i)}
            </span>
          </span>
          <button type="button" className="button subtle small" onClick={() => void window.moho.copyText(i.link).then(() => store.toast('info', 'Invite link copied'))}>
            Copy
          </button>
          <ConfirmButton label="Delete" question={`Delete the invite ${i.code}? The link stops working.`} confirmLabel="Delete" danger onConfirm={() => void act('deleteInvite', { code: i.code }).then(load)} />
        </div>
      ))}
      <div className="field-row">
        <button type="button" className="button" disabled={busy} onClick={make}>
          Make an invite
        </button>
      </div>
    </>
  )
}

/** Who is banned from a Fluxer community, and letting them back in. */
function Bans({ bufferId, act }: { bufferId: string; act: Act }): JSX.Element {
  const store = useStore()
  const [list, setList] = useState<{ userId: string; name: string; reason?: string | null }[] | null>(null)
  const load = useCallback(() => {
    void act<{ bans: { userId: string; name: string; reason?: string | null }[] }>('bans').then((r) => setList(r?.bans ?? []))
  }, [act])
  useEffect(load, [load])
  const unban = (userId: string, name: string): void => {
    void ask('moderateStoatMember', { bufferId, userId, action: 'unban' })
      .then(() => {
        store.toast('info', `${name} may join again`)
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }
  return (
    <>
      <p className="small muted">Somebody banned cannot join again, even with an invite, until the ban is lifted. Ban from a member&apos;s menu in the member list.</p>
      {list === null && <p className="small muted">Asking…</p>}
      {list?.length === 0 && <p className="small muted">Nobody is banned.</p>}
      {list?.map((b) => (
        <div key={b.userId} className="field-row steam-group-row">
          <Icon name="gavel" size={16} />
          <span className="grow ellipsis">
            {b.name}
            {b.reason ? <span className="small muted"> · {b.reason}</span> : null}
          </span>
          <ConfirmButton label="Lift the ban" question={`Let ${b.name} join again?`} confirmLabel="Lift it" onConfirm={() => unban(b.userId, b.name)} />
        </div>
      ))}
    </>
  )
}

/**
 * Deleting a Fluxer community, for its owner: for good, with everything in it. Fluxer asks for proof it is the owner
 * at the keyboard - the account's password, or its authenticator's code when it has one - so both are asked here,
 * with the community's name typed out first.
 */
function DeleteCommunity({ bufferId, server, onDone }: { bufferId: string; server: Overview; onDone: () => void }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const accountId = bufferId.split('|')[0]
  const go = (): void => {
    setBusy(true)
    void window.moho
      .rpc('deleteFluxerGuild', { groupId: `${accountId}|guild:${server.serverId}`, password, code })
      .then(async () => {
        store.toast('info', `Deleted ${server.name}`)
        await store.refreshBuffers()
        onDone()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  return (
    <div className="field danger-zone">
      <span className="small muted">Delete this community</span>
      {!open ? (
        <div className="field-row">
          <span className="grow small muted">Everything in it goes with it - channels, messages, roles and invites - and it cannot be brought back.</span>
          <button type="button" className="button danger small" onClick={() => setOpen(true)}>
            Delete community…
          </button>
        </div>
      ) : (
        <>
          <input className="text-field" placeholder={`Type ${server.name} to confirm`} aria-label="The community's name" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <input className="text-field" type="password" placeholder="Your Fluxer password" aria-label="Your Fluxer password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="text-field" placeholder="Or your authenticator's code, if the account has one" aria-label="Authenticator code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="field-row">
            <button type="button" className="button danger" disabled={busy || typed !== server.name || (!password && !code.trim())} onClick={go}>
              Delete for good
            </button>
            <button type="button" className="button quiet" disabled={busy} onClick={() => setOpen(false)}>
              Keep it
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Audit({ act }: { act: Act }): JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [more, setMore] = useState(true)
  const load = (before?: string): void => {
    void act<{ entries: AuditEntry[] }>('auditLog', before ? { before } : {}).then((r) => {
      const got = r?.entries ?? []
      setEntries((held) => [...(before ? (held ?? []) : []), ...got])
      setMore(got.length >= 50)
    })
  }
  useEffect(() => load(), []) // eslint-disable-line react-hooks/exhaustive-deps
  if (entries === null) return <p className="small muted">Asking…</p>
  if (entries.length === 0) return <p className="small muted">Nothing has been recorded.</p>
  return (
    <>
      {entries.map((e) => (
        <div key={e.id} className="field-row steam-group-row">
          <span className="grow">{e.text}</span>
          <span className="small muted">{new Date(e.ts * 1000).toLocaleString()}</span>
        </div>
      ))}
      {more && (
        <div className="field-row">
          <button type="button" className="button subtle" onClick={() => load(entries[entries.length - 1].id)}>
            Older
          </button>
        </div>
      )}
    </>
  )
}

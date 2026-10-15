import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import { classes } from '../lib/util'
import { useEscapeLayer } from '../lib/layers'

/**
 * What a channel will trade its points for, in a panel over the chat like the quick switcher (Ctrl+K).
 *
 * One panel for every service that has channel points - Kick and Twitch - instead of a menu or a dialog of its
 * own for each. A reward is a row: its name, what it asks, what it costs. Pressing one arms it (a second press,
 * or the Redeem button, spends the points; Escape takes it back), so an errant click never costs anything. A
 * reward that asks the person to type something shows its field when it is armed.
 */
export interface Reward {
  id: string
  title: string
  cost: number
  description?: string | null
  enabled: boolean
  paused: boolean
  needsInput: boolean
  color?: string | null
  image?: string | null
  /** Why it cannot be had from here, where that is known beforehand. */
  unavailable?: string | null
  /** What it asks the person to pick from: an emote to unlock. */
  choices?: Choice[]
}

/** One thing a reward asks the person to pick: an emote, or a change to one. */
export interface Choice {
  id: string
  label: string
  image?: string | null
  /** For a change to an emote: the emote, and its picture. */
  group?: string | null
  groupImage?: string | null
}

interface Answer {
  rewards: Reward[]
  points: number | null
  name?: string | null
}

/** The daemon's answer - or, in the screenshot harness only, a fixture standing in for it (see SteamGroupSettings). */
function ask<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __mohoShots?: unknown; __rpcFixture?: Record<string, (p: Record<string, unknown>) => unknown> }
  const stub = w.__mohoShots ? w.__rpcFixture?.[method] : undefined
  return stub ? Promise.resolve(stub(params) as T) : window.moho.rpc<T>(method, params)
}

/** How each service lists and redeems, named once here so the panel need not know who it is for. */
const SERVICES = {
  kick: { list: 'listKickRewards', redeem: 'redeemKickReward', canType: false },
  twitch: { list: 'listTwitchRewards', redeem: 'redeemTwitchReward', canType: true }
} as const

/** Why a reward cannot be pressed, in words; empty when it can. */
export function whyNot(r: Reward, points: number | null, canType: boolean): string {
  if (r.unavailable) return r.unavailable
  if (!r.enabled) return 'The streamer has this turned off'
  if (r.paused) return 'Paused right now'
  if (r.needsInput && !canType) return 'This one asks you to type something, which moho cannot do for this service yet'
  if (points !== null && points < r.cost) return `You have ${points.toLocaleString()} of ${r.cost.toLocaleString()}`
  return ''
}

/**
 * The emotes a reward offers, shown as the emotes - pictures to press, with a search - the way the emoji picker shows
 * them, and not as a list of names. A change to an emote (Modify a Single Emote) is two steps: the emote, then what
 * to do to it.
 */
function EmoteChooser({ choices, picked, onPick }: { choices: Choice[]; picked: string; onPick: (id: string) => void }): JSX.Element {
  const [filter, setFilter] = useState('')
  const [base, setBase] = useState<string | null>(null)
  const grouped = choices.some((c) => c.group)
  const q = filter.trim().toLowerCase()
  const bases = useMemo(() => {
    const seen = new Map<string, string | null | undefined>()
    for (const c of choices) if (c.group && !seen.has(c.group)) seen.set(c.group, c.groupImage)
    return [...seen.entries()].map(([name, image]) => ({ name, image }))
  }, [choices])
  const cell = (key: string, label: string, image: string | null | undefined, selected: boolean, onClick: () => void, caption?: string): JSX.Element => (
    <button key={key} type="button" className={classes('reward-emote', selected && 'selected')} title={label} onClick={onClick}>
      {image ? <img src={image} alt={label} loading="lazy" /> : <span>{label}</span>}
      {caption && <span className="reward-emote-caption small muted">{caption}</span>}
    </button>
  )
  const inBase = base ? choices.filter((c) => c.group === base) : []
  return (
    <div className="reward-chooser">
      {!(grouped && base) && (
        <input className="text-field" placeholder="Search emotes" value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
      )}
      {grouped && base ? (
        <>
          <div className="reward-chooser-head small">
            <button type="button" className="link-button" onClick={() => setBase(null)}>
              ← {base}
            </button>
            <span className="muted">Choose what is done to it</span>
          </div>
          <div className="reward-grid">{inBase.map((c) => cell(c.id, c.label, c.image, picked === c.id, () => onPick(c.id), c.label.slice(base.length + 2)))}</div>
        </>
      ) : grouped ? (
        <div className="reward-grid">{bases.filter((b) => !q || b.name.toLowerCase().includes(q)).map((b) => cell(b.name, b.name, b.image, false, () => setBase(b.name)))}</div>
      ) : (
        <div className="reward-grid">{choices.filter((c) => !q || c.label.toLowerCase().includes(q)).map((c) => cell(c.id, c.label, c.image, picked === c.id, () => onPick(c.id)))}</div>
      )}
      {picked && <div className="small muted reward-picked">{choices.find((c) => c.id === picked)?.label}</div>}
    </div>
  )
}

export function RewardsPanel({
  bufferId,
  service,
  onClose,
  onBalance
}: {
  bufferId: string
  service: keyof typeof SERVICES
  onClose: () => void
  /** The balance after a redeem, for the plaque behind the panel. */
  onBalance: (points: number) => void
}): JSX.Element {
  const store = useStore()
  const api = SERVICES[service]
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [armed, setArmed] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void ask<Answer>(api.list, { bufferId })
      .then((a) => !cancelled && setAnswer(a))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [api.list, bufferId])

  useEffect(() => input.current?.focus(), [])
  // Escape takes an armed reward back first, then closes the panel - wherever focus is.
  useEscapeLayer(() => (armed ? setArmed(null) : onClose()), true)

  // Cheapest first, the ones that can be had now above the ones that cannot (switched off, paused, too dear).
  const { shown, firstDisabled } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = answer?.rewards ?? []
    const found = q ? all.filter((r) => r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : all
    const byCost = (a: Reward, b: Reward): number => a.cost - b.cost || a.title.localeCompare(b.title)
    const pressable = (r: Reward): boolean => !whyNot(r, answer?.points ?? null, api.canType)
    const active = found.filter(pressable).sort(byCost)
    const disabled = found.filter((r) => !pressable(r)).sort(byCost)
    return { shown: [...active, ...disabled], firstDisabled: active.length }
  }, [answer, query, api.canType])

  useEffect(() => {
    list.current?.querySelector('.switcher-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index, shown.length])

  const points = answer?.points ?? null
  const unit = answer?.name || 'points'

  const redeem = (r: Reward): void => {
    setBusy(true)
    void ask<{ points: number | null }>(api.redeem, { bufferId, rewardId: r.id, ...(r.needsInput ? { input: typed } : {}), ...(r.choices?.length ? { choice: picked } : {}) })
      .then((a) => {
        store.toast('info', `Redeemed ${r.title}`)
        if (a.points !== null && a.points !== undefined) {
          setAnswer((cur) => (cur ? { ...cur, points: a.points } : cur))
          onBalance(a.points)
        }
        setArmed(null)
        setTyped('')
        setPicked('')
        // An emote unlock changes what there is left to unlock: asked again.
        if (r.choices?.length) {
          void ask<Answer>(api.list, { bufferId }).then(setAnswer).catch(() => undefined)
        }
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const press = (r: Reward): void => {
    if (whyNot(r, points, api.canType) || busy) return
    if (armed === r.id && (!r.needsInput || typed.trim()) && (!r.choices?.length || picked)) redeem(r)
    else {
      setArmed(r.id)
      setTyped('')
      setPicked('')
    }
  }

  return createPortal(
    <div className="modal-scrim switcher-scrim" onMouseDown={onClose}>
      <div className="switcher rewards" role="dialog" aria-modal="true" aria-label="Channel points rewards" onMouseDown={(e) => e.stopPropagation()}>
        <div className="switcher-field">
          <Icon name="toll" size={18} />
          <input
            ref={input}
            className="switcher-input"
            placeholder="Spend channel points on…"
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
              setArmed(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault()
                setIndex((i) => Math.min(shown.length - 1, i + 1))
                setArmed(null)
              } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
                setArmed(null)
              } else if (e.key === 'Enter' && shown[index]) {
                e.preventDefault()
                press(shown[index])
              }
            }}
          />
          <span className="rewards-balance small" title={`Your ${unit} here`}>
            {points === null ? '' : `${points.toLocaleString()} ${unit === 'points' ? '' : unit}`.trim()}
          </span>
        </div>
        <div className="switcher-list" ref={list} role="listbox">
          {error && <div className="switcher-empty muted">{error}</div>}
          {!error && !answer && <div className="switcher-empty muted">Asking {service === 'kick' ? 'Kick' : 'Twitch'}…</div>}
          {answer && shown.length === 0 && <div className="switcher-empty muted">{answer.rewards.length === 0 ? 'This channel offers nothing for points.' : 'Nothing by that name.'}</div>}
          {shown.map((r, i) => {
            const why = whyNot(r, points, api.canType)
            const isArmed = armed === r.id
            return (
              <div key={r.id} className={classes('reward-item', isArmed && 'armed')}>
                {i === 0 && firstDisabled > 0 && <div className="reward-group small muted">Available</div>}
                {i === firstDisabled && shown.length > firstDisabled && <div className="reward-group small muted">Unavailable</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  disabled={!!why || busy}
                  title={why || r.description || r.title}
                  className={classes('switcher-row', 'reward-row', i === index && 'selected', why && 'locked')}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => {
                    setIndex(i)
                    press(r)
                  }}
                >
                  <span className="switcher-lead">
                    {r.image ? <img className="reward-image" src={r.image} alt="" /> : <Icon name="redeem" size={16} color={r.color ?? undefined} />}
                  </span>
                  <span className="switcher-title ellipsis">{r.title}</span>
                  <span className="switcher-where muted small ellipsis">{why || r.description || ''}</span>
                  <span className="reward-cost small">{r.cost.toLocaleString()}</span>
                </button>
                {isArmed && (
                  <div className="reward-confirm">
                    {r.needsInput && (
                      <input
                        className="text-field"
                        autoFocus
                        placeholder={r.description || 'What it asks for'}
                        value={typed}
                        maxLength={500}
                        onChange={(e) => setTyped(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && typed.trim()) redeem(r)
                        }}
                      />
                    )}
                    {!!r.choices?.length && <EmoteChooser choices={r.choices} picked={picked} onPick={setPicked} />}
                    <button type="button" className="button primary" disabled={busy || (r.needsInput && !typed.trim()) || (!!r.choices?.length && !picked)} onClick={() => redeem(r)}>
                      Redeem for {r.cost.toLocaleString()}
                    </button>
                    <button type="button" className="button subtle" onClick={() => setArmed(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="switcher-hint muted small">
          <span>↑↓ to move</span>
          <span>Enter to choose, again to spend</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

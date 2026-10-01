import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from './Icon'
import { Avatar } from './Avatar'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { useChat, useStore } from '../state/hooks'
import type { VoiceChannel } from '../../../shared/wire'

/** One scheduled event, as the daemon describes it. */
interface DiscordEvent {
  id: string
  guildId: string
  name: string
  description?: string | null
  /** RFC 3339. */
  start: string
  end?: string | null
  live: boolean
  where: 'voice' | 'stage' | 'external'
  channelId?: string | null
  channelName?: string | null
  location?: string | null
  creatorId?: string | null
  creatorName?: string | null
  creatorAvatar?: string | null
  image?: string | null
  userCount: number
  interested: boolean
  link: string
}

/**
 * When an event is, the way Discord says it: "Today at 7:00 PM",
 * "Tomorrow at 7:00 PM", "Fri, Oct 9 at 7:00 PM".
 */
export function eventWhen(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  if (days === 0) return `Today at ${time}`
  if (days === 1) return `Tomorrow at ${time}`
  const date = at.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  })
  return `${date} at ${time}`
}

/**
 * A guild's events, in a pane over everything - opened from the events row at
 * the top of its channel list, as Discord opens it.
 */
export function EventsPane(): JSX.Element | null {
  const store = useStore()
  const pane = useChat((s) => s.eventsPane)
  const counts = useChat((s) => s.discordEventCounts)
  const [events, setEvents] = useState<DiscordEvent[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; event: DiscordEvent } | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    if (!pane) return
    void window.moho
      .rpc<DiscordEvent[]>('listDiscordEvents', pane)
      .then(setEvents)
      .catch((e: Error) => {
        setEvents([])
        store.toast('error', `Couldn't read the events: ${e.message}`)
      })
  }, [pane, store])

  useEffect(() => {
    setEvents(null)
    load()
  }, [load])

  // Kept current while open: somebody else marking interest, starting it,
  // cancelling it - each arrives as a change in the guild's count, and is
  // read again from the source.
  const count = pane ? counts[`${pane.accountId}|${pane.guildId}`] : undefined
  useEffect(() => {
    if (count !== undefined) load()
  }, [count, load])

  useEffect(() => {
    if (!pane) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !menu) store.closeEvents()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pane, menu, store])

  if (!pane) return null

  const act = (event: DiscordEvent, method: string, params: Record<string, unknown>, failed: string): void => {
    setBusy(event.id)
    void window.moho
      .rpc(method, { ...pane, eventId: event.id, ...params })
      .then(load)
      .catch((e: Error) => store.toast('error', `${failed}: ${e.message}`))
      .finally(() => setBusy(''))
  }

  const copyLink = (event: DiscordEvent): void => {
    void navigator.clipboard
      .writeText(event.link)
      .then(() => store.toast('info', 'Link to the event copied'))
      .catch(() => store.toast('error', "Couldn't copy the link"))
  }

  const menuFor = (event: DiscordEvent): MenuEntry[] => [
    ...(event.live
      ? [{ label: 'End event', icon: 'stop_circle', onClick: () => act(event, 'setDiscordEventStatus', { status: 'end' }, "Couldn't end it") }]
      : [
          { label: 'Start event', icon: 'play_circle', onClick: () => act(event, 'setDiscordEventStatus', { status: 'start' }, "Couldn't start it") },
          {
            label: 'Cancel event',
            icon: 'event_busy',
            danger: true,
            onClick: () => act(event, 'setDiscordEventStatus', { status: 'cancel' }, "Couldn't cancel it")
          }
        ]),
    { separator: true },
    { label: 'Copy event link', icon: 'link', onClick: () => copyLink(event) }
  ]

  const n = events?.length ?? 0
  return createPortal(
    <div className="lightbox-backdrop" onClick={() => store.closeEvents()}>
      <div className="events-pane" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Events">
        <div className="events-pane-head">
          <Icon name="calendar_month" size={22} />
          <span className="events-pane-count">
            {events === null ? 'Events' : `${n} Event${n === 1 ? '' : 's'}`}
          </span>
          <span className="events-pane-sep" />
          <button type="button" className="button primary" onClick={() => store.openEventCreate(pane.accountId, pane.guildId)}>
            Create Event
          </button>
          <span className="events-pane-spacer" />
          <IconButton name="close" title="Close" onClick={() => store.closeEvents()} />
        </div>

        <div className="events-pane-list">
          {events === null && <p className="small muted">Loading…</p>}
          {events !== null && n === 0 && (
            <div className="events-pane-empty muted">
              <Icon name="event" size={32} />
              <span>Nothing is scheduled. Create an event and it will show here.</span>
            </div>
          )}
          {events?.map((event) => (
            <div key={event.id} className={`event-card${event.live ? ' live' : ''}`}>
              {event.image && <img className="event-card-image" src={event.image} alt="" />}
              <div className="event-card-body">
                <div className="event-card-when">
                  <Icon name={event.live ? 'radio_button_checked' : 'calendar_month'} size={16} />
                  <span>{event.live ? 'Happening now' : eventWhen(event.start)}</span>
                  <span className="events-pane-spacer" />
                  {event.creatorName && <Avatar name={event.creatorName} url={event.creatorAvatar ?? undefined} size={20} />}
                  <span className="event-card-count" title={`${event.userCount} interested`}>
                    <Icon name="group" size={14} />
                    {event.userCount}
                  </span>
                </div>
                <div className="event-card-name">{event.name}</div>
                {event.description && <div className="event-card-desc small muted">{event.description}</div>}
              </div>
              <div className="event-card-foot">
                <span className="event-card-where ellipsis">
                  <Icon name={event.where === 'stage' ? 'podium' : event.where === 'voice' ? 'volume_up' : 'location_on'} size={16} />
                  <span className="ellipsis">
                    {event.where === 'external' ? event.location : event.channelName ?? 'A channel'}
                  </span>
                </span>
                <span className="events-pane-spacer" />
                <button
                  type="button"
                  className="event-button icon-only"
                  title="More"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setMenu({ x: r.left, y: r.bottom + 4, event })
                  }}
                >
                  <Icon name="more_horiz" size={18} />
                </button>
                <button type="button" className="event-button" onClick={() => copyLink(event)}>
                  <Icon name="ios_share" size={16} />
                  Share
                </button>
                <button
                  type="button"
                  className={`event-button${event.interested ? ' on' : ''}`}
                  disabled={busy === event.id}
                  onClick={() => act(event, 'setDiscordEventInterest', { on: !event.interested }, "Couldn't change that")}
                >
                  <Icon name={event.interested ? 'check' : 'notifications'} size={16} />
                  Interested
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuFor(menu.event)} onClose={() => setMenu(null)} />}
    </div>,
    document.body
  )
}

/** A date and a time, as the two inputs hold them, from a Date. */
function parts(d: Date): { date: string; time: string } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

/** The two inputs back to an instant, in this machine's time zone. */
function instant(date: string, time: string): Date | null {
  if (!date || !time) return null
  const at = new Date(`${date}T${time}`)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * Creating an event: where it happens, what it is, and when - the three
 * things Discord's own panel asks, on one page.
 */
export function EventCreatePanel(): JSX.Element | null {
  const store = useStore()
  const target = useChat((s) => s.eventCreate)
  const [channels, setChannels] = useState<VoiceChannel[]>([])
  const [kind, setKind] = useState<'voice' | 'stage' | 'external'>('voice')
  const [channelId, setChannelId] = useState('')
  const [location, setLocation] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // An hour from now, on the hour: the commonest answer, and in the future.
  const initial = useMemo(() => {
    const d = new Date(Date.now() + 3_600_000)
    d.setMinutes(0, 0, 0)
    return parts(d)
  }, [])
  const [startDate, setStartDate] = useState(initial.date)
  const [startTime, setStartTime] = useState(initial.time)
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!target) return
    void window.moho
      .rpc<VoiceChannel[]>('listVoiceChannels', target)
      .then((list) => {
        setChannels(list)
        const first = list.find((c) => !c.stage) ?? list[0]
        if (first) {
          setChannelId(first.id)
          setKind(first.stage ? 'stage' : 'voice')
        } else {
          setKind('external')
        }
      })
      .catch(() => setChannels([]))
  }, [target])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') store.closeEventCreate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, store])

  if (!target) return null

  const offered = channels.filter((c) => (kind === 'stage' ? c.stage : !c.stage))
  const start = instant(startDate, startTime)
  const end = instant(endDate, endTime)
  // Said before it is sent, rather than learned from Discord's refusal.
  const problem = !name.trim()
    ? 'Give it a name'
    : !start || start.getTime() <= Date.now()
      ? 'It has to start in the future'
      : end && end <= start
        ? 'It has to end after it starts'
        : kind === 'external' && !location.trim()
          ? 'Say where it happens'
          : kind === 'external' && !end
            ? 'An event somewhere else needs an end time'
            : kind !== 'external' && !channelId
              ? 'Pick the channel it happens in'
              : ''

  const create = (): void => {
    if (problem || !start) return
    setSending(true)
    void window.moho
      .rpc('createDiscordEvent', {
        ...target,
        name: name.trim(),
        description: description.trim(),
        start: start.toISOString(),
        end: end ? end.toISOString() : undefined,
        kind,
        channelId: kind === 'external' ? undefined : channelId,
        location: kind === 'external' ? location.trim() : undefined
      })
      .then(() => {
        store.toast('info', `${name.trim()} is scheduled`)
        store.closeEventCreate()
        store.openEvents(target.accountId, target.guildId)
      })
      .catch((e: Error) => store.toast('error', `Couldn't create the event: ${e.message}`))
      .finally(() => setSending(false))
  }

  const choice = (value: typeof kind, icon: string, label: string, hint: string, disabled = false): JSX.Element => (
    <label className={`event-where${kind === value ? ' on' : ''}${disabled ? ' disabled' : ''}`}>
      <input
        type="radio"
        name="event-where"
        checked={kind === value}
        disabled={disabled}
        onChange={() => {
          setKind(value)
          const first = channels.find((c) => (value === 'stage' ? c.stage : !c.stage))
          if (value !== 'external') setChannelId(first?.id ?? '')
        }}
      />
      <Icon name={icon} size={20} />
      <span>
        <span className="event-where-label">{label}</span>
        <span className="small muted">{hint}</span>
      </span>
    </label>
  )

  return createPortal(
    <div className="lightbox-backdrop" onClick={() => store.closeEventCreate()}>
      <div className="events-pane event-create" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Create an event">
        <div className="events-pane-head">
          <Icon name="calendar_add_on" size={22} />
          <span className="events-pane-count">Create an event</span>
          <span className="events-pane-spacer" />
          <IconButton name="close" title="Close" onClick={() => store.closeEventCreate()} />
        </div>

        <div className="event-create-body">
          <div className="event-create-section">
            <div className="event-create-title">Where is your event?</div>
            <div className="event-create-hint small muted">So no one gets lost on where to go.</div>
            {choice('stage', 'podium', 'Stage Channel', 'For events with an audience', !channels.some((c) => c.stage))}
            {choice('voice', 'volume_up', 'Voice Channel', 'Hang out with voice, video, screen share', !channels.some((c) => !c.stage))}
            {choice('external', 'location_on', 'Somewhere Else', 'Text channel, external link, or in-person location')}
            {kind === 'external' ? (
              <input
                className="text-field"
                placeholder="Add a location, link, or something."
                maxLength={100}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            ) : (
              <select className="text-field" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {offered.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="event-create-section">
            <div className="event-create-title">What's your event about?</div>
            <label className="event-field">
              <span className="small muted">Event topic</span>
              <input
                className="text-field"
                placeholder="What's your event?"
                maxLength={100}
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="event-field-row">
              <label className="event-field">
                <span className="small muted">Start date</span>
                <input className="text-field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="event-field">
                <span className="small muted">Start time</span>
                <input className="text-field" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
            </div>
            <div className="event-field-row">
              <label className="event-field">
                <span className="small muted">End date{kind === 'external' ? '' : ' (optional)'}</span>
                <input className="text-field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
              <label className="event-field">
                <span className="small muted">End time{kind === 'external' ? '' : ' (optional)'}</span>
                <input className="text-field" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
            <label className="event-field">
              <span className="small muted">Description</span>
              <textarea
                className="text-field"
                rows={4}
                maxLength={1000}
                placeholder="Tell people a little more about your event."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="event-create-foot">
          <span className="small muted">{problem}</span>
          <span className="events-pane-spacer" />
          <button type="button" className="button subtle" onClick={() => store.closeEventCreate()}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!!problem || sending} onClick={create}>
            {sending ? 'Creating…' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

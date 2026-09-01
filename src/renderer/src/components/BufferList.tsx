import { useEffect, useMemo, useState } from 'react'
import { Icon, MaskIcon } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { UserFooter } from './UserFooter'
import { VoiceChannels } from './VoiceChannels'
import { VoicePanel } from './VoicePanel'
import { useChat, useIdSetPref, useMapPref, usePref, useStore } from '../state/hooks'
import {
  dmGroup,
  DM_GROUP_ID,
  isDirectMessage,
  isMutedBuffer,
  MENTIONS_GROUP_ID,
  PINNED_GROUP_ID,
  pinnedGroup,
  visibleGroups,
  type RailGroup
} from '../lib/groups'
import type { BufferEntry } from '../state/store'
import {
  bufferDisplayName,
  bufferKindGlyph,
  classes,
  resolveMediaUrl,
  serviceIcon
} from '../lib/util'
import type { Account, Member } from '../../../shared/wire'
import { Avatar } from './Avatar'
import { categoryKey, sections, type CategorySection, type CustomCategory } from '../lib/categories'

/**
 * Buffers grouped under a collapsible header per account, rather than one flat
 * list - "which service" is first-class everywhere else in this client, so the
 * sidebar reads that way too. Discord channels get a second level of grouping
 * per guild, because a single guild can easily carry 30+ text channels that
 * would otherwise flood every other account's rows.
 */
export function BufferList(): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const activeBufferId = useChat((s) => s.activeBufferId)
  const groups = useChat((s) => s.groups)
  const activeGroupId = useChat((s) => s.activeGroupId)
  const voiceSessions = useChat((s) => s.voiceSessions)
  const presence = useChat((s) => s.presenceByBuffer)
  const popouts = useChat((s) => s.popouts)

  const [pinned, togglePin, isPinned] = useIdSetPref('pinnedBuffers')
  const [muted, toggleMute] = useIdSetPref('mutedBuffers')
  const [hidden, , isHidden] = useIdSetPref('hiddenBuffers')
  const [mutedGroups] = usePref<string[]>('mutedGroups', [])
  // Headings a person made, per rail entry, and which channel goes under
  // which. Kept here rather than in the daemon: a heading you invented is not
  // something any other client of the same account would agree about.
  const [customCats, setCustomCats] = useMapPref<CustomCategory[]>('customCategories')
  const [assignment, setAssignment] = useMapPref<string>('channelCategory')
  const [, toggleCollapsed, isCollapsed] = useIdSetPref('collapsedCategories')
  const [, setHidden] = usePref<string[]>('hiddenBuffers', [])

  const visible = useMemo(() => buffers.filter((b) => !hidden.includes(b.id)), [buffers, hidden])

  // A stale selection (a guild that went away, a first run) resolves to the
  // first entry rather than an empty pane. The pinned page is added the same
  // way the rail adds it, so both agree on what is selectable.
  const shownGroups = useMemo(() => {
    const list: RailGroup[] = [...visibleGroups(groups, visible)]
    if (visible.some(isDirectMessage)) list.push(dmGroup())
    if (pinned.length > 0) list.push(pinnedGroup())
    return list
  }, [groups, visible, pinned])
  /**
   * The mentions page has no rail tile and belongs to no server, so there is
   * no group for this pane to show.
   *
   * Called out rather than left to the fallback below, which exists for a
   * selection that has gone stale and lands on the first entry. That is right
   * for a guild that was left, and wrong here: the mentions page is a real
   * destination, and falling back filled the sidebar with an unrelated
   * server's channels and put its account on the plaque - an identity nobody
   * had selected.
   */
  const onMentionsPage = activeGroupId === MENTIONS_GROUP_ID
  /**
   * Where to go when the selected entry is no longer in the rail.
   *
   * Whatever is being read, if it is still somewhere. An account's tile
   * disappears the moment its first direct message arrives - its buffers now
   * live on the shared direct messages page rather than in the account, and
   * that is what the tile was for - so a conversation open at the time would
   * otherwise take the pane to whichever server happens to sit first in the
   * rail. Being moved to an unrelated server because somebody sent a message
   * is a worse answer than any of the alternatives.
   *
   * A direct message's own group is folded away in the rail, so it answers
   * with the page that replaced it.
   */
  const openBufferGroup = useMemo(() => {
    const open = buffers.find((b) => b.id === activeBufferId)
    if (!open) return undefined
    return isDirectMessage(open) ? DM_GROUP_ID : open.groupId
  }, [buffers, activeBufferId])

  const activeGroup = onMentionsPage
    ? undefined
    : shownGroups.find((g) => g.id === activeGroupId) ||
      shownGroups.find((g) => g.id === openBufferGroup) ||
      shownGroups[0]
  /**
   * Settles a selection that had to be resolved by falling back.
   *
   * Without this the fallback is re-run on every render, so the pane sits on
   * a group nothing has actually selected and moves the moment the rail
   * changes shape - a direct message arriving is enough, since it adds an
   * entry and can take an account's own tile away. Writing the answer back
   * once means the next change has a real selection to keep.
   */
  useEffect(() => {
    if (onMentionsPage || !activeGroup) return
    if (activeGroup.id !== activeGroupId) store.selectGroup(activeGroup.id)
  }, [activeGroup, activeGroupId, onMentionsPage, store])

  const isPinnedPage = activeGroup?.id === PINNED_GROUP_ID
  const isDmPage = activeGroup?.id === DM_GROUP_ID
  /**
   * Whose identity the plaque shows.
   *
   * The direct-messages and pinned pages deliberately belong to no account -
   * they gather conversations from every service - so there is no group
   * account to read. Falling back to the account of whatever is open keeps
   * the plaque present on those pages, which matters beyond the name on it:
   * the microphone and speaker buttons live there, and losing them because
   * of which page you happen to be on leaves no way to mute during a call.
   */
  const activeBuffer = buffers.find((b) => b.id === activeBufferId)
  const groupAccount =
    // The mentions page is nobody's: it gathers every service, and the fallback
    // chain below would put the account of whatever happens to be open behind
    // it onto the plaque. The one exception is a live call - the microphone and
    // speaker buttons live on the plaque and nowhere else, and taking them away
    // because of which page is open leaves no way to mute mid-call.
    onMentionsPage && voiceSessions.length === 0
      ? undefined
      : (accounts.find((a) => a.id === activeGroup?.accountId) ??
        accounts.find((a) => a.id === activeBuffer?.accountId) ??
        accounts[0])

  /**
   * What the pane lists, in reading order: pinned first, then direct messages,
   * then channels, each band by most recent activity.
   *
   * The pinned page is the same list unfiltered by group - a pin is a
   * cross-service shortcut, so its page is the one place they all appear
   * together.
   */
  const groupBuffers = useMemo(() => {
    if (!activeGroup) return []
    const inScope = isPinnedPage
      ? visible.filter((b) => pinned.includes(b.id))
      : isDmPage
        ? visible.filter(isDirectMessage)
        : visible.filter((b) => b.groupId === activeGroup.id)

    // Server buffer above everything; then pinned, DMs, channels.
    const band = (b: BufferEntry): number => {
      if (b.kind === 'server') return 0
      if (!isPinnedPage && pinned.includes(b.id)) return 1
      if (b.kind === 'dm') return 2
      return 3
    }
    return [...inScope].sort(
      (a, b) => band(a) - band(b) || (b.lastActivityTs || 0) - (a.lastActivityTs || 0)
    )
  }, [visible, activeGroup, isPinnedPage, isDmPage, pinned])

  /**
   * The rows, under their headings.
   *
   * Every page can have them, the pinned and direct-message pages included.
   * They were left out on the grounds that each is already one flat idea, but
   * that is exactly backwards for the pages that gather everything: a guild's
   * channels arrive sorted into the server's own categories, while the direct
   * message page is one undifferentiated column of every conversation on
   * every service, which is where a person most wants to impose some order.
   *
   * Ordinary channels sort by the service's own position within a heading,
   * since that is the order the server arranged them in and the reason it
   * supplies one. The gathered pages have no such order to respect and keep
   * the recency they were already sorted by.
   */
  const grouped = useMemo(() => {
    if (!activeGroup) return null
    const mine = customCats[activeGroup.id] ?? []
    const list = sections(groupBuffers, mine, assignment)
    if (!isPinnedPage && !isDmPage) {
      for (const s of list) {
        s.buffers.sort((a, b) => (a.position || 0) - (b.position || 0))
      }
    }
    // A heading with nothing under it is still drawn when it is the user's -
    // they just made it, and a heading that vanishes until something is put
    // in it cannot have anything put in it.
    return list.filter((s) => s.custom || s.buffers.length > 0)
  }, [activeGroup, isPinnedPage, isDmPage, groupBuffers, customCats, assignment])

  // The menu still toggles a buffer's *own* flag independently of a muted
  // rail entry above it, the same way muting a channel inside an
  // already-muted Slack workspace works.
  const isEffectivelyMuted = (buffer: BufferEntry): boolean =>
    isMutedBuffer(buffer, muted, mutedGroups)

  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null)
  const { menu: groupMenu, open: openGroupMenuAt, close: closeGroupMenu } = useContextMenu()
  const [catMenu, setCatMenu] = useState<{ x: number; y: number; section: CategorySection } | null>(null)

  const myCategories = activeGroup ? (customCats[activeGroup.id] ?? []) : []
  const writeCategories = (next: CustomCategory[]): void => {
    if (activeGroup) setCustomCats(activeGroup.id, next)
  }

  const openGroupMenu = (e: React.MouseEvent): void => openGroupMenuAt(e)
  const openCategoryMenu = (e: React.MouseEvent, section: CategorySection): void => {
    e.preventDefault()
    // Only a heading you made is yours to rename or remove; a server's
    // category is theirs, and offering to rename it would be a lie.
    if (!section.custom) return
    setCatMenu({ x: e.clientX, y: e.clientY, section })
  }

  const renderRow = (b: BufferEntry): JSX.Element => (
    <BufferRow
      key={b.id}
      buffer={b}
      active={b.id === activeBufferId}
      muted={isEffectivelyMuted(b)}
      pinned={isPinned(b.id)}
      accounts={accounts}
      // Already on the page being shown; keep the rail where it is.
      onSelect={() => void store.selectBuffer(b.id, false)}
      onTogglePin={() => togglePin(b.id)}
      onToggleMute={() => toggleMute(b.id)}
      onHide={() => hideBuffer(b.id)}
      onClose={() => void store.closeBuffer(b.id)}
      inCall={voiceSessions.some((s) => s.bufferId === b.id)}
      status={dmStatus(b, presence, buffers)}
      onCall={() => void store.callBuffer(b.id)}
      onHangUp={() => void store.leaveVoice(b.accountId)}
      categories={activeGroup ? (customCats[activeGroup.id] ?? []) : []}
      onFile={(categoryId) => setAssignment(b.id, categoryId)}
      poppedOut={popouts.open.includes(b.id)}
      onPopOut={() => store.popOut(b.id)}
      onDock={() => store.dock(b.id)}
    />
  )

  const hideBuffer = (id: string): void => {
    if (!isHidden(id)) setHidden([...hidden, id])
  }

  return (
    <div className="bufferlist">
      <div className="bufferlist-scroll">
        {accounts.length === 0 && (
          <div className="bufferlist-empty muted small">
            No accounts yet. Add one to get started.
          </div>
        )}

        {/* Not on the mentions page, which is deliberately server-less: the
            pane is empty there because there is nothing to list, not because
            something still needs picking. */}
        {accounts.length > 0 && !activeGroup && !onMentionsPage && (
          <div className="bufferlist-empty muted small">Select a server on the left.</div>
        )}

        {activeGroup && (
          <>
            <div className="group-title">
              <button
                type="button"
                className="ellipsis group-title-name"
                title={`${activeGroup.name} — organise this list`}
                onClick={grouped ? openGroupMenu : undefined}
                disabled={!grouped}
              >
                {activeGroup.name}
                {grouped && <Icon name="expand_more" size={14} />}
              </button>
              {/* Only where the page is actually one account's. The direct
                  messages and pinned pages gather several, so a single
                  connection light there says nothing about any of them - and
                  says it in the confident green of something that means
                  something. */}
              {activeGroup.accountId && groupAccount && <ConnectionDot state={groupAccount.state} />}
            </div>

            {groupBuffers.length === 0 && (
              <div className="bufferlist-empty muted small">Nothing here yet.</div>
            )}

            {grouped
              ? grouped.map((section) => {
                  const key = categoryKey(activeGroup.id, section)
                  const folded = isCollapsed(key)
                  return (
                    <div key={section.key} className="category">
                      {section.name && (
                        <button
                          type="button"
                          className="category-head small"
                          onClick={() => toggleCollapsed(key)}
                          onContextMenu={(e) => openCategoryMenu(e, section)}
                          title={section.custom ? 'Your heading — right-click to rename or remove' : section.name}
                        >
                          <Icon name={folded ? 'chevron_right' : 'expand_more'} size={14} />
                          <span className="ellipsis">{section.name}</span>
                          {folded && section.buffers.length > 0 && (
                            <span className="muted category-count">{section.buffers.length}</span>
                          )}
                        </button>
                      )}
                      {/* A collapsed heading still shows the channel you are
                          reading, or selecting it from elsewhere would appear
                          to do nothing. */}
                      {section.buffers
                        .filter((b) => !folded || b.id === activeBufferId)
                        .map((b) => renderRow(b))}
                      {section.custom && section.buffers.length === 0 && !folded && (
                        <div className="category-empty small muted">
                          Right-click a channel to file it here
                        </div>
                      )}
                    </div>
                  )
                })
              : groupBuffers.map((b) => renderRow(b))}


            {/* Below the text channels, as everywhere else that has both. */}
            <VoiceChannels group={activeGroup} />
          </>
        )}
      </div>

      {groupMenu && activeGroup && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          entries={[
            {
              label: 'New category',
              icon: 'create_new_folder',
              onClick: () => {
                const id = `cat-${Date.now().toString(36)}`
                writeCategories([...myCategories, { id, name: 'New category' }])
                // Straight into renaming it: a heading called "New category"
                // is not one anybody meant to keep.
                setNaming({ id, name: 'New category' })
              }
            }
          ]}
          onClose={closeGroupMenu}
        />
      )}

      {catMenu && (
        <ContextMenu
          x={catMenu.x}
          y={catMenu.y}
          entries={[
            {
              label: 'Rename',
              icon: 'edit',
              onClick: () =>
                setNaming({ id: catMenu.section.key, name: catMenu.section.name ?? '' })
            },
            {
              label: 'Remove',
              icon: 'delete',
              danger: true,
              // The channels stay; only the heading goes, and they fall back
              // to wherever the service filed them.
              onClick: () => writeCategories(myCategories.filter((c) => c.id !== catMenu.section.key))
            }
          ]}
          onClose={() => setCatMenu(null)}
        />
      )}

      {naming && (
        <div className="category-naming">
          <input
            autoFocus
            className="text-field"
            value={naming.name}
            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(null)
              if (e.key === 'Enter') {
                const name = naming.name.trim()
                if (name) {
                  writeCategories(myCategories.map((c) => (c.id === naming.id ? { ...c, name } : c)))
                }
                setNaming(null)
              }
            }}
            onBlur={() => setNaming(null)}
          />
        </div>
      )}

      {/* Outside the group above, so a call stays visible and hangable-up
          wherever you navigate. */}
      <VoicePanel />

      <div className="divider-h" />
      <UserFooter account={groupAccount} />
    </div>
  )
}

/**
 * The other person's status in a direct message.
 *
 * Three sources, in descending order of directness. A DM's own roster is the
 * people in it other than you, so for a one-to-one conversation there is
 * exactly one and it is them - that is Discord and Matrix, which report
 * presence properly.
 *
 * IRC reports none, but it does say who is in a channel, and somebody sitting
 * in a channel with you is by definition connected. So a query with a nick
 * visible anywhere else on the same account counts as online - or away, which
 * IRC does have. This is why the lookup is worth doing rather than showing a
 * permanent grey dot on every IRC conversation.
 *
 * Failing both, they are reported offline: for a protocol where presence is
 * knowable, not knowing means not there.
 */
export function dmStatus(
  buffer: BufferEntry,
  presence: Record<string, Member[]>,
  buffers: BufferEntry[]
): string | undefined {
  if (buffer.kind !== 'dm') return undefined

  const own = presence[buffer.id]
  if (own?.length === 1 && own[0].status) return own[0].status

  const name = buffer.name.toLowerCase()
  for (const b of buffers) {
    if (b.accountId !== buffer.accountId) continue
    const member = presence[b.id]?.find((m) => m.nick.toLowerCase() === name)
    if (member) return member.away ? 'idle' : 'online'
  }
  return 'offline'
}

/**
 * What closing this conversation will actually do.
 *
 * It used to say "Close" everywhere and mean "stop drawing this", which was
 * the bug: on Matrix you stayed in the room and it reappeared on the next
 * sync. Now it leaves for real, so the menu has to say so - and say the right
 * thing, since what leaving means differs. A guild's channel is the exception
 * and is honest about it: you are in it because you are in the guild, so there
 * is nothing to leave and this only hides it.
 */
function leaveLabel(buffer: BufferEntry, service?: string): string {
  if (buffer.kind === 'dm') return service === 'discord' ? 'Close conversation' : 'Leave conversation'
  if (service === 'matrix') return 'Leave room'
  if (service === 'irc') return 'Leave channel'
  if (service === 'discord') return 'Remove from list'
  return 'Close'
}

function ConnectionDot({ state }: { state: string }): JSX.Element {
  const color =
    state === 'connected'
      ? 'var(--success)'
      : state === 'connecting'
        ? 'var(--warning)'
        : 'var(--outline)'
  return <span className="connection-dot" style={{ background: color }} title={state} />
}

interface BufferRowProps {
  buffer: BufferEntry
  active: boolean
  muted: boolean
  pinned: boolean
  accounts: Account[]
  /** Pinned rows sit outside their account group, so they carry the service
   * mark instead of the buffer-kind glyph to show where they belong. */
  showServiceIcon?: boolean
  onSelect: () => void
  onTogglePin: () => void
  onToggleMute: () => void
  onHide: () => void
  onClose: () => void
  onCall: () => void
  onHangUp: () => void
  /** Headings this list offers, so a channel can be filed under one. */
  categories: CustomCategory[]
  onFile: (categoryId: string) => void
  /** A call is already up in this conversation. */
  inCall: boolean
  /** This conversation has a window of its own. */
  poppedOut: boolean
  onPopOut: () => void
  onDock: () => void
  /** The other person's presence, for a direct message. */
  status?: string
}

function BufferRow({
  buffer,
  active,
  muted,
  pinned,
  accounts,
  showServiceIcon,
  onSelect,
  onTogglePin,
  onToggleMute,
  onHide,
  onClose,
  onCall,
  onHangUp,
  inCall,
  status,
  categories,
  onFile,
  poppedOut,
  onPopOut,
  onDock
}: BufferRowProps): JSX.Element {
  const { menu, open, close } = useContextMenu()
  const account = accounts.find((a) => a.id === buffer.accountId)

  // Under an account header the row's own kind is what's worth showing (a
  // channel vs a DM vs the server buffer). A pinned row has no header above
  // it, so it shows the service instead - the Discord or Matrix mark, or the
  // "#" that IRC channels already use - rather than repeating the account
  // name as text in front of every entry.
  const service = serviceIcon(account?.service ?? '')
  const leading = showServiceIcon ? (
    service.mark ? (
      <MaskIcon src={service.mark} size={15} />
    ) : (
      <Icon name={service.glyph!} size={15} />
    )
  ) : buffer.kind === 'dm' ? (
    // A conversation with a person is headed by that person, whatever
    // protocol they are on: their picture where there is one, their initial
    // where there is not.
    <Avatar name={buffer.name} url={buffer.avatarUrl} size={22} status={status} />
  ) : buffer.avatarUrl ? (
    <img className="buffer-avatar" src={resolveMediaUrl(buffer.avatarUrl)} alt="" />
  ) : (
    <Icon name={bufferKindGlyph(buffer.kind)} size={15} />
  )

  // Calling from the row it belongs to, as well as from the header of the
  // conversation once it is open - the list is where you look for somebody
  // you want to reach, so it is where reaching them should be offered.
  const canCall = account?.service === 'discord' && buffer.kind === 'dm'

  const entries: MenuEntry[] = [
    ...(canCall
      ? ([
          inCall
            ? { label: 'Hang up', icon: 'call_end', danger: true, onClick: onHangUp }
            : { label: 'Call', icon: 'call', onClick: onCall }
        ] as MenuEntry[])
      : []),
    ...(canCall ? ([{ separator: true }] as MenuEntry[]) : []),
    // Above pin and mute because it is the one that opens something: the two
    // below change how this row behaves, and this one goes somewhere.
    poppedOut
      ? { label: 'Close its window', icon: 'close_fullscreen', onClick: onDock }
      : { label: 'Open in a new window', icon: 'open_in_new', onClick: onPopOut },
    { separator: true },
    { label: pinned ? 'Unpin' : 'Pin', icon: 'push_pin', onClick: onTogglePin },
    { label: muted ? 'Unmute' : 'Mute', icon: muted ? 'notifications' : 'notifications_off', onClick: onToggleMute },
    { separator: true },
    ...(categories.length
      ? ([
          { separator: true },
          ...categories.map((c) => ({
            label: `File under ${c.name}`,
            icon: 'folder',
            onClick: () => onFile(c.id)
          })),
          { label: 'Remove from category', icon: 'folder_off', onClick: () => onFile('') },
          { separator: true }
        ] as MenuEntry[])
      : []),
    { label: 'Hide', icon: 'visibility_off', onClick: onHide },
    ...(buffer.kind === 'server'
      ? []
      : ([
          {
            label: leaveLabel(buffer, account?.service),
            icon: 'close',
            danger: true,
            onClick: onClose
          }
        ] as MenuEntry[]))
  ]

  return (
    <>
      <button
        type="button"
        className={classes('buffer-row', active && 'active', buffer.highlight && 'highlight')}
        onClick={onSelect}
        onContextMenu={open}
        title={buffer.name}
      >
        {leading}
        <span className="ellipsis buffer-name">{bufferDisplayName(buffer.name)}</span>
        {/* So a conversation with no unread count and no traffic in it is
            explained rather than merely quiet: it is being read elsewhere. */}
        {poppedOut && <Icon name="open_in_new" size={13} className="buffer-muted-icon" />}
        {muted && <Icon name="notifications_off" size={13} className="buffer-muted-icon" />}
        {buffer.unread > 0 && !muted && (
          <span className={classes('unread-badge', buffer.highlight && 'highlight')}>
            {buffer.unread > 99 ? '99+' : buffer.unread}
          </span>
        )}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}
    </>
  )
}

import type { MenuEntry } from '../components/ContextMenu'
import { serviceLabel } from './util'
import type { Account, BufferGroup } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'

/**
 * The menu a conversation carries, in one place because two things open it.
 *
 * It began inline in the buffer list's own row, which was right while the row
 * was the only way to reach it. The header's nameplate opens the same menu
 * now, and a second copy of a hundred lines of entries is the kind of thing
 * that agrees with the first until somebody edits one of them.
 *
 * A bag of values rather than a component's props: the two callers know
 * different amounts about a conversation - the row knows it is being dragged,
 * the header knows it is the one on screen - and what they share is exactly
 * what is below.
 */
export interface BufferMenuInput {
  buffer: BufferEntry
  account?: Account
  muted: boolean
  pinned: boolean
  filed: boolean
  inCall: boolean
  poppedOut: boolean
  canCall: boolean
  /** Kick only: whether the channel is on air, and whether it is the one playing here. */
  live: boolean
  watched: boolean
  autojoins?: boolean
  spaces?: BufferGroup[]
  onTogglePin: () => void
  onToggleMute: () => void
  onToggleAutojoin?: () => void
  onSpace?: (spaceId: string, child: boolean) => void
  onWatch?: () => void
  onStopWatching?: () => void
  onOpenInBrowser?: () => void
  onHide: () => void
  onClose: () => void
  onCall: () => void
  onHangUp: () => void
  onFile: (categoryId: string) => void
  onPopOut: () => void
  onDock: () => void
}

/** What leaving is called, which depends on what is being left. */
export function leaveLabel(buffer: BufferEntry, service?: string): string {
  if (buffer.kind === 'dm') return service === 'discord' ? 'Close conversation' : 'Leave conversation'
  if (service === 'matrix') return 'Leave room'
  if (service === 'irc') return 'Leave channel'
  if (service === 'discord') return 'Remove from list'
  return 'Close'
}

export function bufferMenuEntries({
  buffer,
  account,
  muted,
  pinned,
  filed,
  inCall,
  poppedOut,
  canCall,
  live,
  watched,
  autojoins,
  spaces,
  onTogglePin,
  onToggleMute,
  onToggleAutojoin,
  onSpace,
  onWatch,
  onStopWatching,
  onOpenInBrowser,
  onHide,
  onClose,
  onCall,
  onHangUp,
  onFile,
  onPopOut,
  onDock
}: BufferMenuInput): MenuEntry[] {
  return [
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
    // A Kick channel is a stream as well as a chat, and the stream is not
    // something this client shows - so the way to watch it belongs on the
    // row, next to the way to open its chat in a window.
    // Which space this room belongs to. A space is the server's own grouping,
    // unlike the categories above it, so this writes to the room rather than
    // to this window - and a room can be in more than one, which is why the
    // one it is in now is offered for removal rather than swapped silently.
    ...(spaces && spaces.length > 0 && buffer.kind !== 'server'
      ? ([
          ...spaces
            .filter((space) => space.id !== buffer.groupId)
            .map((space) => ({
              label: `Add to ${space.name}`,
              icon: 'move_to_inbox',
              onClick: () => void onSpace?.(space.id, true)
            })),
          ...(spaces.some((space) => space.id === buffer.groupId)
            ? [
                {
                  label: `Remove from ${spaces.find((s) => s.id === buffer.groupId)?.name ?? 'this space'}`,
                  icon: 'outbox',
                  onClick: () => void onSpace?.(buffer.groupId ?? '', false)
                }
              ]
            : []),
          { separator: true }
        ] as MenuEntry[])
      : []),
    // Watching is offered only while there is something to watch: an offline
    // channel's playlist is a signed URL to nothing, and an entry that fails
    // a few seconds after being pressed is worse than one that isn't there.
    ...(onWatch && (live || watched)
      ? ([
          watched
            ? { label: 'Stop watching', icon: 'stop_circle', danger: true, onClick: onStopWatching! }
            : { label: 'Watch the stream', icon: 'live_tv', onClick: onWatch }
        ] as MenuEntry[])
      : []),
    ...(onOpenInBrowser
      ? ([{ label: 'Open in browser', icon: 'public', onClick: onOpenInBrowser }] as MenuEntry[])
      : []),
    { separator: true },
    // Which channels an account rejoins on connect is a property of the
    // channels, so it is set on one - it used to be a comma-separated field
    // in the add-account form, typed once and never seen again.
    ...(onToggleAutojoin
      ? ([
          {
            label: autojoins ? 'Do not join automatically' : 'Join automatically',
            icon: autojoins ? 'bookmark_remove' : 'bookmark_add',
            onClick: onToggleAutojoin
          }
        ] as MenuEntry[])
      : []),
    { label: pinned ? 'Unpin' : 'Pin', icon: 'push_pin', onClick: onTogglePin },
    // A mute made on the account itself is not this window's to undo, and an
    // "Unmute" that quietly did nothing would be worse than no entry at all -
    // so it says where the mute is, and where to go and take it off.
    buffer.serverMuted
      ? {
          label: account ? `Muted on ${serviceLabel(account.service)}` : 'Muted on this account',
          icon: 'notifications_off',
          disabled: true,
          onClick: () => {}
        }
      : { label: muted ? 'Unmute' : 'Mute', icon: muted ? 'notifications' : 'notifications_off', onClick: onToggleMute },
    { separator: true },
    // Filing is a drag onto the heading now, not an entry per heading. That
    // list grew with the number of headings and had no ceiling - on a server
    // with twenty categories the menu was taller than the screen, which made
    // every other entry on it unreachable.
    //
    // Taking a channel back out has no gesture, since the channels under no
    // heading are drawn without one to drop onto - so it stays here, as the
    // one entry it always was, and only where there is something to undo.
    ...(filed
      ? ([
          { separator: true },
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
}

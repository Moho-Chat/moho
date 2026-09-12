import { useState } from 'react'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { ExportDialog } from './ExportDialog'
import { Avatar } from './Avatar'
import { bufferMenuEntries } from '../lib/buffermenu'
import { dmStatus } from './BufferList'
import { bufferDisplayName, classes } from '../lib/util'
import { useChat, useStore } from '../state/hooks'
import { useIdSetPref, useMapPref, usePref } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/**
 * The conversation's own name at the top of the window, and the menu behind it.
 *
 * Two things wanted a home and this is both. The header had a name that was
 * only a label, and export needed somewhere to live that was not the buffer
 * list's right-click menu - which is already long, and would have been made
 * longer for every user to serve the few who export anything.
 *
 * The menu is the same one the row carries, built by the same code (see
 * lib/buffermenu.ts), with export added. Same options on purpose: somebody who
 * has the conversation open should not have to go and find its row in a list
 * to mute it.
 *
 * The state behind it is read from the same preference hooks the list uses, so
 * there is one answer to what is pinned or hidden rather than two that have to
 * be kept in step.
 */
export function ConversationMenu({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const accounts = useChat((s) => s.accounts)
  const groups = useChat((s) => s.groups)
  const voiceSessions = useChat((s) => s.voiceSessions)
  const popouts = useChat((s) => s.popouts)
  const live = useChat((s) => s.kickStreams[buffer.id]?.live ?? false)
  const presence = useChat((s) => s.presenceByBuffer)
  const buffers = useChat((s) => s.buffers)
  const watched = useChat((s) => s.watching?.bufferId === buffer.id)

  const [, togglePin, isPinned] = useIdSetPref('pinnedBuffers')
  const [, toggleMute, isMuted] = useIdSetPref('mutedBuffers')
  const [hidden, setHidden] = usePref<string[]>('hiddenBuffers', [])
  const [assignment, setAssignment] = useMapPref<string>('channelCategory')

  const { menu, open, close } = useContextMenu()
  const [exporting, setExporting] = useState(false)
  const [held, setHeld] = useState<{ oldest?: number; count?: number }>({})

  const account = accounts.find((a) => a.id === buffer.accountId)
  const name = bufferDisplayName(buffer.name)

  const entries: MenuEntry[] = [
    ...bufferMenuEntries({
      buffer,
      account,
      muted: isMuted(buffer.id),
      pinned: isPinned(buffer.id),
      filed: !!assignment[buffer.id],
      inCall: voiceSessions.some((s) => s.bufferId === buffer.id),
      poppedOut: popouts.open.includes(buffer.id),
      canCall: account?.service === 'discord' && buffer.kind === 'dm',
      live,
      watched,
      autojoins: store.autojoins(buffer.accountId, name),
      spaces: groups.filter((g) => g.kind === 'space' && g.accountId === buffer.accountId),
      onTogglePin: () => togglePin(buffer.id),
      onToggleMute: () => {
        toggleMute(buffer.id)
        if (account?.service === 'matrix') {
          void window.moho
            .rpc('setMatrixRoomMuted', { bufferId: buffer.id, muted: !isMuted(buffer.id) })
            .catch((e: Error) => store.toast('error', e.message))
        }
      },
      onToggleAutojoin:
        buffer.kind === 'channel' && account?.service === 'irc'
          ? () => store.toggleAutojoin(buffer.accountId, name)
          : undefined,
      onSpace: (spaceId, child) =>
        void store.setMatrixSpaceChild(spaceId, buffer.id, child).catch((e: Error) => store.toast('error', e.message)),
      onWatch: buffer.accountId.startsWith('kick:') ? () => store.watchStream(buffer.id) : undefined,
      onStopWatching: () => store.stopWatching(),
      onOpenInBrowser: buffer.accountId.startsWith('kick:')
        ? () => void window.moho.openExternal(`https://kick.com/${name}`)
        : undefined,
      onHide: () => {
        if (!hidden.includes(buffer.id)) setHidden([...hidden, buffer.id])
      },
      onClose: () => void store.closeBuffer(buffer.id),
      onCall: () => void store.callBuffer(buffer.id),
      onHangUp: () => void store.leaveVoice(buffer.accountId),
      onFile: (categoryId) => setAssignment(buffer.id, categoryId),
      onPopOut: () => store.popOut(buffer.id),
      onDock: () => store.dock(buffer.id)
    }),
    { separator: true },
    // Last, and on its own. It is the one entry here that starts something
    // long rather than changing a setting, and the only one that writes
    // outside moho.
    {
      label: 'Export…',
      icon: 'download',
      onClick: () => {
        // Asked before the dialog opens so it can say what it will not be able
        // to reach, rather than finding out halfway through.
        void window.moho
          .rpc<{ count: number; oldestHeld: number | null }>('countMessageRange', {
            bufferId: buffer.id,
            after: 0
          })
          .then((a) => setHeld({ oldest: a.oldestHeld ?? undefined, count: a.count }))
          .catch(() => setHeld({}))
          .finally(() => setExporting(true))
      }
    }
  ]

  return (
    <>
      <button
        type="button"
        className={classes('header-nameplate', menu && 'open')}
        title={`${name} — options`}
        aria-haspopup="menu"
        onClick={(e) => open(e)}
      >
        {buffer.kind === 'dm' || buffer.avatarUrl ? (
          <Avatar
            name={buffer.name}
            url={buffer.avatarUrl}
            size={24}
            status={dmStatus(buffer, presence, buffers)}
          />
        ) : null}
        <span className="main-header-title ellipsis">{name}</span>
      </button>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}

      {exporting && (
        <ExportDialog
          title={name}
          service={account?.service}
          oldestHeld={held.oldest}
          heldCount={held.count}
          onCancel={() => setExporting(false)}
          onConfirm={(range, opts) => {
            setExporting(false)
            void store.exportConversation(buffer.id, range, opts)
          }}
        />
      )}
    </>
  )
}

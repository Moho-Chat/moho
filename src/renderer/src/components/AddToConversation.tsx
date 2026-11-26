import { useMediaUrl } from '../lib/route'
import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { HeaderPopover } from './HeaderPopover'
import { useChat, useStore } from '../state/hooks'
import { classes } from '../lib/util'
import type { BufferEntry } from '../state/store'
import type { DiscordFriend } from '../../../shared/wire'
import { useEscapeLayer } from '../lib/layers'

/** Ten people including you, which is Discord's own ceiling. */
const GROUP_DM_MAX_OTHERS = 9

/**
 * Bringing somebody else into a conversation already open.
 *
 * There was no way to do it at all: a group could be started from scratch in
 * the join pane by picking several names at once, but a conversation already
 * underway - the case where wanting a third person actually comes up - had
 * nowhere to ask.
 *
 * What it does depends on what this is, because Discord draws a hard line
 * between the two. A group takes the person directly. A one-to-one cannot be
 * converted at all, so adding to one starts a new group carrying the same
 * people, and says so first rather than leaving somebody to work out why
 * their conversation appears to have forked.
 */
export function AddToConversation({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const media = useMediaUrl(buffer.accountId)
  const store = useStore()
  const roster = useChat((s) => s.presenceByBuffer[buffer.id])
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<DiscordFriend[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const accountId = buffer.accountId
  // Fluxer's groups take the same two steps as Discord's: a group takes the person, a one-to-one starts a new group.
  const fluxer = accountId.startsWith('fluxer:')
  const service = fluxer ? 'Fluxer' : 'Discord'
  // A Fluxer account's id is its user id behind the service's prefix.
  const own = fluxer ? accountId.slice('fluxer:'.length) : undefined
  // Everyone already here, this account excluded - the daemon leaves it out
  // of a direct message's roster, which is the same list Discord sends.
  // Fluxer's roster has the account in it as well, so it is taken out here.
  const present = (roster ?? []).map((m) => m.userId).filter((u): u is string => !!u && u !== own)
  const isGroup = fluxer ? buffer.category === 'Groups' : present.length > 1
  const room = GROUP_DM_MAX_OTHERS - present.length

  useEffect(() => {
    if (!open) return
    // Fluxer's friends are on the same page as its requests, one shape for every Discord-like service.
    const list = fluxer
      ? window.moho
          .rpc<{ friends: { id: string; name: string | null; avatarUrl?: string | null; online?: boolean }[] }>('stoatFriendRequests', { accountId })
          .then((r) => r.friends.map((f): DiscordFriend => ({ userId: f.id, username: f.name || f.id, avatarUrl: f.avatarUrl, status: f.online ? 'online' : 'offline', kind: 'friend' })))
      : window.moho.rpc<DiscordFriend[]>('listDiscordFriends', { accountId })
    void list.then(setFriends).catch((e: Error) => store.toast('error', e.message))
  }, [open, accountId, store, fluxer])

  useEscapeLayer(() => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => {
      document.removeEventListener('mousedown', away)
    }
  }, [open])

  const toggle = (id: string): void => {
    const has = picked.includes(id)
    if (!has && picked.length >= room) {
      store.toast('info', `A group message holds ${GROUP_DM_MAX_OTHERS + 1} people including you.`)
      return
    }
    setPicked(has ? picked.filter((p) => p !== id) : [...picked, id])
  }

  const confirm = (): void => {
    if (picked.length === 0) return
    setBusy(true)
    const done = (): void => {
      setBusy(false)
      setPicked([])
      setOpen(false)
    }
    if (isGroup) {
      // Added one at a time: Discord's endpoint takes a single recipient, and
      // one name failing should not take the others with it.
      Promise.allSettled(
        picked.map((userId) =>
          window.moho.rpc('addToDiscordGroupDm', { accountId, bufferId: buffer.id, userId })
        )
      )
        .then((results) => {
          const failed = results.filter((r) => r.status === 'rejected').length
          if (failed) store.toast('error', `${failed} of ${picked.length} could not be added.`)
        })
        .finally(done)
      return
    }
    // A one-to-one cannot take a third person - Discord answers by making a
    // new group instead - so the people already here come along explicitly.
    void window.moho
      .rpc<{ bufferId: string }>('openDiscordGroupDm', {
        accountId,
        userIds: [...present, ...picked]
      })
      .then((r) => {
        store.toast('info', 'Started a group message - the original conversation is still here.')
        return store.selectBuffer(r.bufferId)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(done)
  }

  // Nothing to add to: the roster has not arrived, or the group is full.
  if (present.length === 0) return null

  const available = friends.filter((f) => !present.includes(f.userId))

  return (
    <div className="add-to-dm" ref={box}>
      <IconButton
        name="person_add"
        title={isGroup ? 'Add someone to this group' : 'Start a group with someone else'}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <HeaderPopover anchor={box.current} width={280} className="add-to-dm-pop" onClose={() => setOpen(false)}>
          <div className="add-to-dm-head small">
            {room <= 0
              ? `This group is full - ${service} allows ${GROUP_DM_MAX_OTHERS + 1} people including you.`
              : isGroup
                ? 'Add to this group'
                : `${service} cannot add to a one-to-one conversation, so this starts a group with the same people.`}
          </div>

          {room > 0 && available.length === 0 && (
            <p className="small muted">Nobody left to add from your friends.</p>
          )}

          {room > 0 &&
            available.map((f) => (
              <button
                key={f.userId}
                type="button"
                className={classes('friend-row', picked.includes(f.userId) && 'picked')}
                onClick={() => toggle(f.userId)}
              >
                <Icon
                  name={picked.includes(f.userId) ? 'check_circle' : 'radio_button_unchecked'}
                  size={16}
                />
                {f.avatarUrl ? (
                  <img className="friend-avatar" src={media(f.avatarUrl)} alt="" />
                ) : (
                  <span className="friend-avatar placeholder">
                    {(f.globalName || f.username).slice(0, 1)}
                  </span>
                )}
                <span className="ellipsis">{f.globalName || f.username}</span>
                <span className={`status-dot ${f.status || 'offline'}`} />
              </button>
            ))}

          {room > 0 && (
            <div className="add-to-dm-actions">
              <button
                type="button"
                className="button primary"
                disabled={picked.length === 0 || busy}
                onClick={confirm}
              >
                {isGroup ? 'Add' : 'Start group'}
              </button>
            </div>
          )}
        </HeaderPopover>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { useChat, useIdSetPref, useStore } from '../state/hooks'
import { classes } from '../lib/util'
import { steamGroupOfRail } from '../lib/steamchat'
import type { RailGroup } from '../lib/groups'

/**
 * The rooms of a Steam group that have voice, listed under its text ones the
 * way a Discord server's voice channels are, with who is in each shown before
 * you join: that is what anyone decides on.
 *
 * Steam keeps who is in a room's voice chat with the room, so the list is what
 * the daemon last said, and joining is this window's: see lib/steamvoice.ts.
 */
export function SteamVoiceRooms({ group }: { group: RailGroup }): JSX.Element | null {
  const store = useStore()
  const groupId = steamGroupOfRail(group.id)
  const rooms = useChat((s) => (groupId ? s.steamVoiceRooms[`${group.accountId}|${groupId}`] : undefined)) ?? []
  const now = useChat((s) => s.steamVoiceNow)
  const [, toggleFolded, isFolded] = useIdSetPref('collapsedCategories')
  const foldKey = `steamvoice|${group.id}`
  const here = (roomId: string): boolean => now?.target.kind === 'room' && now.accountId === group.accountId && now.target.groupId === groupId && now.target.roomId === roomId
  const inThisGroup = rooms.some((r) => here(r.roomId))
  const live = useLive(inThisGroup)

  useEffect(() => {
    if (groupId) void store.refreshSteamVoiceRooms(group.accountId, groupId)
  }, [store, group.accountId, groupId])

  if (!groupId || rooms.length === 0) return null

  return (
    <>
      <button
        type="button"
        className="bufferlist-section category-head"
        onClick={() => toggleFolded(foldKey)}
        title={isFolded(foldKey) ? 'Show voice rooms' : 'Hide voice rooms'}
      >
        <Icon name="expand_more" size={14} className={classes('fold-chevron', isFolded(foldKey) && 'folded')} />
        <span>Voice</span>
      </button>

      {rooms
        .filter((r) => !isFolded(foldKey) || here(r.roomId))
        .map((r) => {
          const connected = here(r.roomId)
          return (
            <div key={r.roomId} className={`voice-channel${connected ? ' active' : ''}`}>
              <div className="voice-channel-row">
                <button
                  type="button"
                  className="voice-channel-main"
                  title={connected ? `Connected to ${r.name}` : `Join ${r.name}`}
                  onClick={() => (connected ? void store.leaveVoice(group.accountId) : void store.joinSteamVoice(group.accountId, groupId, r.roomId))}
                >
                  <Icon name="volume_up" size={16} />
                  <span className="ellipsis">{r.name}</span>
                  {connected && now?.phase !== 'connected' && <span className="spinner" />}
                </button>
                {connected && <IconButton name="call_end" size={16} title="Disconnect" onClick={() => void store.leaveVoice(group.accountId)} />}
              </div>
              {r.members.map((m) => {
                const status = live.statuses.get(m.userId)
                return (
                  <div key={m.userId} className={classes('voice-member small', live.speakers.has(m.userId) && 'speaking')}>
                    <span className="voice-member-face">
                      <Avatar name={m.nick} url={m.avatarUrl ?? undefined} size={20} accountId={group.accountId} />
                    </span>
                    <span className="ellipsis">{m.nick}</span>
                    {m.isSelf && <span className="muted voice-you">you</span>}
                    {status?.outputMuted ? (
                      <span className="voice-state" title={`${m.nick} has deafened themselves`}>
                        <Icon name="headset_off" size={13} />
                      </span>
                    ) : (
                      (status?.micMuted || status?.noMic) && (
                        <span className="voice-state" title={status?.noMic ? `${m.nick} has no microphone` : `${m.nick} is muted`}>
                          <Icon name="mic_off" size={13} />
                        </span>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
    </>
  )
}

/** Who is audible and how each person says they are, read from the call this window holds. */
function useLive(inCall: boolean): { speakers: Set<string>; statuses: Map<string, { micMuted: boolean; outputMuted: boolean; noMic: boolean }> } {
  const store = useStore()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!inCall) return
    // Often enough that the ring follows speech; not while nobody can see it.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick((n) => n + 1)
    }, 200)
    return () => clearInterval(timer)
  }, [inCall])
  const v = store.steamVoiceLive
  return { speakers: inCall ? v.speakers : new Set(), statuses: inCall ? v.statuses : new Map() }
}

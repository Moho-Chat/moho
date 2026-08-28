import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import type { VoiceMember } from '../../../shared/wire'

/** How often to ask who is talking. */
const POLL_MS = 300

interface Levels {
  accountId: string
  micPeak: number
  speakers?: { userId: string; peak: number }[]
}

/**
 * The call, while it is happening: who is in it, and who is talking.
 *
 * Above the log rather than instead of it. A call and the conversation it is
 * in are the same conversation - people type links and reactions into a
 * channel while talking in it - and replacing the messages with faces would
 * make the two mutually exclusive.
 *
 * Only for the conversation being read. The panel above the account plaque is
 * the one that follows a call everywhere; this is the detailed view, and a
 * detailed view of a call you have navigated away from is just a picture of
 * somewhere else.
 */
export function CallView({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const sessions = useChat((s) => s.voiceSessions)
  const buffers = useChat((s) => s.buffers)
  const [members, setMembers] = useState<VoiceMember[]>([])
  const [speaking, setSpeaking] = useState<Record<string, number>>({})
  const [folded, setFolded] = useState(false)

  /**
   * The call this conversation should be showing.
   *
   * Two ways to match, because the two kinds of call are anchored
   * differently. A one-to-one call belongs to the DM it is in, and shows on
   * that conversation only. A guild's voice channel belongs to no text
   * conversation at all - it is its own channel, with no buffer - so it shows
   * on whatever channel of that guild is open, which is where Discord keeps
   * it too and the only place it could go without inventing a buffer for it.
   */
  const buffer = buffers.find((b) => b.id === bufferId)
  const session = sessions.find(
    (s) =>
      s.bufferId === bufferId ||
      (!!s.guildId && !!buffer?.groupId && buffer.groupId === `${s.accountId}|guild:${s.guildId}`)
  )
  const accountId = session?.accountId
  const channelId = session?.channelId

  // Who is in it. Re-asked rather than pushed, because arriving and leaving a
  // call are voice-state dispatches this client does not otherwise subscribe
  // to, and a roster that only filled in once would show whoever happened to
  // be there when the call was joined.
  useEffect(() => {
    if (!accountId || !channelId) return
    let live = true
    const load = (): void => {
      void window.moho
        .rpc<VoiceMember[]>('listVoiceMembers', { accountId, channelId })
        .then((rows) => live && setMembers(rows))
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [accountId, channelId])

  // Who is talking. Faster than the roster because this is the part that has
  // to look live - a ring that lagged a second behind the voice would read as
  // the wrong person speaking rather than as a slow indicator.
  useEffect(() => {
    if (!accountId) return
    let live = true
    const tick = (): void => {
      void window.moho
        .rpc<Levels[]>('getVoiceLevels')
        .then((rows) => {
          if (!live) return
          const mine = rows.find((r) => r.accountId === accountId)
          const next: Record<string, number> = {}
          for (const s of mine?.speakers ?? []) next[s.userId] = s.peak
          // Your own microphone never comes back through the call - you do
          // not receive your own audio - so the one person the speaker list
          // structurally cannot name is you. Filled in from the mic meter.
          if (mine && mine.micPeak > SPEAKING_FLOOR) next.self = mine.micPeak
          setSpeaking(next)
        })
        .catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [accountId])

  if (!session) return null

  const talking = (m: VoiceMember): boolean =>
    m.isSelf ? speaking.self !== undefined : (speaking[m.userId] ?? 0) > 0

  return (
    <div className="call-view">
      <div className="call-view-head">
        <Icon name="call" size={16} />
        <span className="ellipsis">
          {session.isDirect ? `Call with ${buffer?.name ?? 'this conversation'}` : session.channelName}
        </span>
        <span className="small muted">
          {members.length > 0 ? `${members.length} in the call` : 'Connecting…'}
        </span>
        <IconButton
          name={folded ? 'expand_more' : 'expand_less'}
          title={folded ? 'Show who is in the call' : 'Hide the faces'}
          onClick={() => setFolded(!folded)}
        />
        <IconButton
          name="call_end"
          title="Hang up"
          className="calling"
          onClick={() => void store.leaveVoice(session.accountId)}
        />
      </div>

      {!folded && (
        <div className="call-tiles">
          {/* Nobody at all means the roster has not arrived yet, not that the
              call is empty - you are in it, which is why it is on screen. */}
          {members.length === 0 && <div className="small muted">Waiting for the roster…</div>}
          {members.map((m) => (
            <div key={m.userId} className={talking(m) ? 'call-tile talking' : 'call-tile'}>
              <Avatar name={m.nick} size={56} />
              <span className="small ellipsis">
                {m.nick}
                {m.isSelf && <span className="muted"> (you)</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Where a microphone stops being a quiet room and starts being speech.
 *
 * The same threshold the level meter in the voice panel uses, measured on
 * real hardware: a silent room still reads around 0.008, so anything lower
 * would leave your own tile permanently ringed.
 */
const SPEAKING_FLOOR = 0.015

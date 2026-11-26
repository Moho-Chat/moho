import { useEffect } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { useStrictRoute } from '../lib/route'
import type { SneedchatStream as Stream } from '../../../shared/wire'

/**
 * A Kiwi Farms room's featured stream, over the log.
 *
 * A moderator features one stream in a listed room - YouTube, Twitch, Kick
 * or Rumble - and the room watches it together: each person opts in, and
 * while they watch the chat lists them under Watching on the member list. It
 * sits where a pin sits because it is the room's pin; the site gives a room
 * one, and a featured stream takes its place.
 *
 * Nothing from the provider loads until Watch is pressed. The player is the
 * provider's own page in a frame, as YouTube links in messages are. Twitch
 * will not play in a frame without the web address of the page around it,
 * which this window does not have, and an account that routes strictly
 * cannot carry a whole player through its route - both open the stream in
 * the browser instead. Watching there is not watching here, so the chat is
 * not told.
 */
export function SneedchatStream({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const buffer = useChat((s) => s.buffers).find((b) => b.id === bufferId)
  const isSneedchat = !!buffer?.accountId.startsWith('sneedchat:') && buffer.kind === 'channel'
  const stream = useChat((s) => s.sneedchatStreams)[bufferId]
  const strict = useStrictRoute(buffer?.accountId)

  useEffect(() => {
    if (isSneedchat) store.ensureSneedchatStream(bufferId)
  }, [bufferId, isSneedchat, store])

  // Leaving the conversation (or closing the window) stops the player, and
  // the chat is told: it should not list somebody as watching what is no
  // longer in front of them.
  useEffect(() => {
    return () => {
      if (store.getSnapshot().sneedchatStreams[bufferId]?.watching) void store.watchSneedchatStream(bufferId, false)
    }
  }, [bufferId, store])

  if (!isSneedchat || !stream) return null
  const playsHere = !!stream.player && !strict
  const outside = (): void => void window.moho.openExternal(stream.url)
  const why = !stream.player
    ? `${stream.providerName} won't play inside moho - it opens in your browser`
    : 'This account routes strictly, and a video player cannot go through its route - it opens in your browser'

  return (
    <div className="sneedchat-stream">
      <div className="pinned-bar sneedchat-stream-bar">
        <Icon name="live_tv" size={14} className="pinned-mark" />
        <div className="pinned-body">
          <span className="small muted">Featured {stream.providerName} stream</span>
          <span className="ellipsis">{stream.source}</span>
        </div>
        {playsHere ? (
          <button
            type="button"
            className="button subtle small"
            onClick={() => void store.watchSneedchatStream(bufferId, !stream.watching)}
            title={stream.watching ? 'Close the player' : 'Watch with the room - the chat lists you as watching'}
          >
            {stream.watching ? 'Stop watching' : 'Watch'}
          </button>
        ) : (
          <button type="button" className="button subtle small" onClick={outside} title={why}>
            Watch in browser
          </button>
        )}
        <IconButton name="open_in_new" size={14} title={`Open on ${stream.providerName}`} onClick={outside} />
      </div>
      {playsHere && stream.watching && <StreamPlayer stream={stream} />}
    </div>
  )
}

function StreamPlayer({ stream }: { stream: Stream }): JSX.Element {
  return (
    <div className="sneedchat-stream-player">
      <iframe
        src={stream.player ?? ''}
        title={`${stream.providerName} stream`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

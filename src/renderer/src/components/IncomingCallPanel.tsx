import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import { Ringtone } from '../lib/ringtone'
import { bufferDisplayName } from '../lib/util'

/**
 * Somebody is calling.
 *
 * Floats over everything rather than living in the conversation it belongs to,
 * because a call arrives while you are looking somewhere else - that is what
 * makes it a call rather than a message. Answering opens that conversation on
 * the way in, so the panel doesn't have to be the only place the call exists.
 *
 * Several at once are stacked rather than collapsed into a count: each is a
 * different person waiting on a different answer, and there is no sensible
 * single button for two of them. Discord's and Matrix's are in the one list,
 * in the one container - two containers at the same corner drew a Discord call
 * and a Matrix call on top of each other.
 */

/** One ring, whichever service it came from. */
interface Ring {
  key: string
  name: string
  avatarUrl?: string
  accountId?: string
  /** Who is ringing and on which account, said under the name. */
  detail: string
  answer: () => void
  /** Only where the offer carries a camera: answering with it is its own choice. */
  answerWithVideo?: () => void
  decline: () => void
}
export function IncomingCallPanel({ silent = false }: { silent?: boolean } = {}): JSX.Element | null {
  const store = useStore()
  const calls = useChat((s) => s.incomingCalls)
  const matrix = useChat((s) => s.ringingCall)
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const ringtone = useRef<Ringtone>()

  const rings: Ring[] = [
    ...calls.map((call): Ring => {
      const buffer = buffers.find((b) => b.id === call.bufferId)
      const account = accounts.find((a) => a.id === call.accountId)
      return {
        key: `d:${call.bufferId}`,
        // A call from a conversation this window has not loaded yet still has
        // to say something. The channel is not a name, but it is not nothing.
        name: buffer ? bufferDisplayName(buffer.name) : 'Someone',
        avatarUrl: buffer?.avatarUrl,
        accountId: buffer?.accountId,
        detail: `Incoming call${account ? ` · ${account.displayName || account.id}` : ''}`,
        answer: () => void store.acceptCall(call.bufferId),
        decline: () => void store.declineCall(call.bufferId)
      }
    }),
    ...(matrix
      ? [
          ((): Ring => {
            const buffer = buffers.find((b) => b.id === matrix.bufferId)
            const account = accounts.find((a) => a.id === matrix.accountId)
            return {
              key: `m:${matrix.callId}`,
              name: buffer ? bufferDisplayName(buffer.name) : matrix.from,
              avatarUrl: buffer?.avatarUrl,
              accountId: buffer?.accountId ?? matrix.accountId,
              detail: `${matrix.from} is calling${matrix.video ? ' · video' : ''}${account ? ` · ${account.displayName || account.id}` : ''}`,
              answer: () => void store.answerMatrixCall(false),
              answerWithVideo: matrix.video ? () => void store.answerMatrixCall(true) : undefined,
              decline: () => store.declineMatrixCall()
            }
          })()
        ]
      : [])
  ]

  // One ringtone for any number of calls: two people calling at once should
  // not ring twice as loudly and out of phase with each other.
  useEffect(() => {
    if (silent) return
    if (!ringtone.current) ringtone.current = new Ringtone()
    if (rings.length > 0) ringtone.current.start()
    else ringtone.current.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rings.length, silent])

  // Silence on the way out. Without this a window closed mid-ring leaves an
  // oscillator running with nothing on screen to explain it.
  useEffect(() => () => ringtone.current?.stop(), [])

  if (rings.length === 0) return null

  return (
    <div className="incoming-calls">
      {rings.map((ring) => (
        <div key={ring.key} className="incoming-call">
          <Avatar name={ring.name} url={ring.avatarUrl} size={44} accountId={ring.accountId} />
          <div className="incoming-call-who">
            <span className="ellipsis incoming-call-name">{ring.name}</span>
            <span className="small muted ellipsis">{ring.detail}</span>
          </div>
          <button type="button" className="call-answer" title={`Answer ${ring.name}`} onClick={ring.answer}>
            <Icon name="call" size={20} />
          </button>
          {ring.answerWithVideo && (
            <button
              type="button"
              className="call-answer"
              title={`Answer ${ring.name} with video`}
              onClick={ring.answerWithVideo}
            >
              <Icon name="videocam" size={20} />
            </button>
          )}
          <button type="button" className="call-decline" title={`Decline ${ring.name}`} onClick={ring.decline}>
            <Icon name="call_end" size={20} />
          </button>
        </div>
      ))}
    </div>
  )
}

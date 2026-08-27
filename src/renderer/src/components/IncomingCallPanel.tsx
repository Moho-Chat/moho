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
 * single button for two of them.
 */
export function IncomingCallPanel(): JSX.Element | null {
  const store = useStore()
  const calls = useChat((s) => s.incomingCalls)
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const ringtone = useRef<Ringtone>()

  // One ringtone for any number of calls: two people calling at once should
  // not ring twice as loudly and out of phase with each other.
  useEffect(() => {
    if (!ringtone.current) ringtone.current = new Ringtone()
    if (calls.length > 0) ringtone.current.start()
    else ringtone.current.stop()
  }, [calls.length])

  // Silence on the way out. Without this a window closed mid-ring leaves an
  // oscillator running with nothing on screen to explain it.
  useEffect(() => () => ringtone.current?.stop(), [])

  if (calls.length === 0) return null

  return (
    <div className="incoming-calls">
      {calls.map((call) => {
        const buffer = buffers.find((b) => b.id === call.bufferId)
        const account = accounts.find((a) => a.id === call.accountId)
        // A call from a conversation this window has not loaded yet still has
        // to say something. The channel is not a name, but it is not nothing.
        const name = buffer ? bufferDisplayName(buffer.name) : 'Someone'
        return (
          <div key={call.bufferId} className="incoming-call">
            <Avatar name={name} url={buffer?.avatarUrl} size={44} />
            <div className="incoming-call-who">
              <span className="ellipsis incoming-call-name">{name}</span>
              <span className="small muted ellipsis">
                Incoming call{account ? ` · ${account.displayName || account.id}` : ''}
              </span>
            </div>
            <button
              type="button"
              className="call-answer"
              title={`Answer ${name}`}
              onClick={() => void store.acceptCall(call.bufferId)}
            >
              <Icon name="call" size={20} />
            </button>
            <button
              type="button"
              className="call-decline"
              title={`Decline ${name}`}
              onClick={() => void store.declineCall(call.bufferId)}
            >
              <Icon name="call_end" size={20} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

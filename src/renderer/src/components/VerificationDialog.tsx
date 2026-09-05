import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'

/**
 * The emoji comparison, over everything.
 *
 * It used to live inside the Matrix account panel, which was fine while the
 * only flow was one you started there. A verification can now arrive from
 * another person - through the room you share, the way Element sends one -
 * and a dialog nobody can see is a request nobody can answer.
 *
 * Whose verification it is leads, because the two cases mean different
 * things: your own session is a device you are letting in, and somebody
 * else's is a person you are vouching for.
 */
export function VerificationDialog(): JSX.Element | null {
  const store = useStore()
  const active = useChat((s) => s.matrixVerification)
  if (!active) return null

  const who = active.otherUser || active.fromUser || ''
  const mine = active.isSelf !== false && (!who || who === active.accountId.replace(/^matrix:/, ''))
  const rpc = (method: string, params: Record<string, unknown>): void => {
    void window.moho
      .rpc(method, { accountId: active.accountId, verificationId: active.verificationId, ...params })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="verification-dialog">
      <div className="verification-head">
        <Icon name={mine ? 'devices' : 'person_check'} size={18} />
        <div className="setting-text">
          <div>{mine ? 'Verifying your other session' : `Verifying ${who}`}</div>
          {active.otherDevice && <div className="small muted">{active.otherDevice}</div>}
        </div>
      </div>

      {active.emoji ? (
        <>
          <div className="small muted">
            {mine
              ? 'Do these match on your other device?'
              : 'Do these match on their screen? Ask them - out loud, not in this chat.'}
          </div>
          <div className="sas-emoji">
            {active.emoji.map((e, i) => (
              <div key={i} className="sas-cell">
                <span className="sas-symbol">{e.symbol}</span>
                <span className="small muted">{e.description}</span>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="button" onClick={() => rpc('confirmMatrixVerification', { matches: true })}>
              They match
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => rpc('confirmMatrixVerification', { matches: false })}
            >
              They don&apos;t
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="small muted">
            {active.state === 'requested'
              ? 'Waiting for you to accept.'
              : `Verification ${active.state || 'starting'}…`}
          </div>
          <div className="button-row">
            {active.state === 'requested' && (
              <button type="button" className="button" onClick={() => rpc('respondMatrixVerification', { accept: true })}>
                Accept
              </button>
            )}
            <button type="button" className="button subtle" onClick={() => rpc('cancelMatrixVerification', {})}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

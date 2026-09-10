import { useEffect, useState } from 'react'
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
  const active = useChat((s) => s.matrixVerification)
  if (!active) return null

  // Keyed on the verification so its QR code is fetched afresh for a new one,
  // rather than a picture of the last session being shown against this one.
  return <VerificationBody key={active.verificationId} />
}

function VerificationBody(): JSX.Element | null {
  const store = useStore()
  const active = useChat((s) => s.matrixVerification)
  const [qr, setQr] = useState<string | null>(null)

  // Asked for once the flow is past "requested" - a code can only be made
  // after both sides have agreed what they are verifying. Answering null is
  // the ordinary case rather than a failure: a QR code proves an identity the
  // other side can already check, so without cross-signing there is nothing
  // to encode and emoji stay the way through.
  useEffect(() => {
    if (!active || active.emoji) return
    let dropped = false
    void window.moho
      .rpc<{ svg: string | null }>('matrixVerificationQrCode', {
        accountId: active.accountId,
        verificationId: active.verificationId
      })
      .then((r) => {
        if (!dropped) setQr(r.svg)
      })
      .catch(() => {
        /* No code to show is not an error worth a toast; emoji still work. */
      })
    return () => {
      dropped = true
    }
  }, [active?.verificationId, active?.state, active?.emoji])

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

          {/* Scanning is the way most people verify, and until now moho had
              nothing to be scanned - Element would offer its camera and this
              side could only answer with emoji. Shown rather than scanned:
              on a desktop the device holding the camera is the other one. */}
          {qr && (
            <div className="verification-qr">
              <div className="small muted">Or scan this from your other device.</div>
              {/* As an image rather than injected markup. The SVG is the
                  daemon's own drawing of a QR grid and carries nothing from
                  anywhere else, but a data URI reaches the same picture
                  without this page ever parsing markup it was handed - and
                  the one habit worth keeping is not making that exception. */}
              <img
                className="verification-qr-code"
                alt="Verification QR code"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`}
              />
            </div>
          )}
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

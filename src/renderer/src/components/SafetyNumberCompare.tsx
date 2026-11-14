import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'

type Result = 'same' | 'different' | 'none' | 'other' | null

/**
 * Comparing a Signal safety number by its QR code, as Signal's apps do in person: this side's code is shown for their
 * phone to scan, and their code is read with the camera (or from a picture of it). A match can then be marked verified.
 */
export function SafetyNumberCompare({ accountId, userId, name, onClose, onVerified }: { accountId: string; userId: string; name: string; onClose: () => void; onVerified: () => void }): JSX.Element {
  const store = useStore()
  const [qr, setQr] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    void window.moho
      .rpc<{ qr: string }>('signalSafetyQr', { accountId, userId })
      .then((r) => setQr(r.qr))
      .catch((e: Error) => {
        store.toast('error', e.message)
        onClose()
      })
  }, [accountId, userId, store, onClose])

  const compare = async (picture: string): Promise<Result> => {
    const r = await window.moho.rpc<{ result: Result }>('signalCompareSafetyQr', { accountId, userId, picture })
    return r.result
  }

  // The camera, looked at a few times a second until a code is found in it.
  useEffect(() => {
    if (!scanning) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let busy = false
    let stopped = false
    const canvas = document.createElement('canvas')
    void navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then((got) => {
        if (stopped) {
          got.getTracks().forEach((t) => t.stop())
          return
        }
        stream = got
        if (video.current) {
          video.current.srcObject = got
          void video.current.play().catch(() => {})
        }
        timer = setInterval(() => {
          const v = video.current
          if (busy || !v || v.readyState < 2) return
          canvas.width = v.videoWidth
          canvas.height = v.videoHeight
          canvas.getContext('2d')?.drawImage(v, 0, 0)
          busy = true
          void compare(canvas.toDataURL('image/png'))
            .then((r) => {
              if (r === 'same' || r === 'different' || r === 'other') {
                setResult(r)
                setScanning(false)
              }
            })
            .catch(() => {})
            .finally(() => {
              busy = false
            })
        }, 400)
      })
      .catch((e: Error) => {
        store.toast('error', `The camera could not be used: ${e.message}`)
        setScanning(false)
      })
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  const fromFile = (): void => {
    void window.moho.pickFile(['png', 'jpg', 'jpeg']).then((path) => {
      if (!path) return
      void compare(`path:${path}`)
        .then(setResult)
        .catch((e: Error) => store.toast('error', e.message))
    })
  }

  const verify = (): void => {
    void window.moho
      .rpc('signalVerify', { accountId, userId, verified: true })
      .then(() => {
        store.toast('info', `${name} is marked verified`)
        onVerified()
        onClose()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <Modal title={`Safety number with ${name}`} icon="qr_code_2" className="modal poll-composer" onClose={onClose}>
      <div className="small muted">
        Scan each other&apos;s code: they scan this one with Signal on their phone (their profile, View safety number), and
        you scan theirs here.
      </div>
      {qr && <img className="qr-image" src={qr} alt="Your safety number code" />}
      {scanning && <video ref={video} className="safety-scan" muted playsInline />}
      {result === 'same' && (
        <div className="field-row">
          <span className="grow">Their code matches: you are talking to {name}&apos;s keys.</span>
          <button type="button" className="button" onClick={verify}>
            Mark verified
          </button>
        </div>
      )}
      {result === 'different' && <div className="profile-warning small">The codes do not match. Check you scanned {name}&apos;s code for you, not somebody else&apos;s.</div>}
      {result === 'other' && <div className="small muted">That code is not a Signal safety number.</div>}
      {result === 'none' && <div className="small muted">No code was found in that picture.</div>}
      <div className="field-row">
        <button type="button" className="button" onClick={() => {
          setResult(null)
          setScanning((s) => !s)
        }}>
          {scanning ? 'Stop scanning' : 'Scan their code'}
        </button>
        <button type="button" className="button subtle" onClick={fromFile}>
          From a picture…
        </button>
      </div>
    </Modal>
  )
}

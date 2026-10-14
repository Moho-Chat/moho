import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/hooks'

/**
 * Signing in to Twitch.
 *
 * Nothing is typed here, and no password is ever seen. Twitch gives a short
 * code, this shows it, and the person approves it on twitch.tv in their own
 * browser, signed in however they sign in (see nobilis backend/twitch/login.rs).
 * Waiting can take minutes, so it is a conversation of events rather than one
 * request: the code, what it is doing, and the result.
 */
interface Scope {
  scope: string
  why: string
}

interface Code {
  userCode: string
  verificationUri: string
  expiresIn: number
  scopes: Scope[]
  at: number
}

/** The scopes the sign-in asks for, said before it is started so nobody has to guess. */
const ASKS: Scope[] = [
  { scope: 'chat:read', why: 'read chat' },
  { scope: 'chat:edit', why: 'send messages' },
  { scope: 'user:write:chat', why: 'hear why Twitch turned a message down' },
  { scope: 'user:read:follows', why: 'list the channels you follow' },
  { scope: 'user:read:emotes', why: 'show the emotes you can use' }
]

export function TwitchSignIn({
  useTor,
  onDone,
  label = 'Sign in with Twitch',
  children
}: {
  useTor: boolean
  onDone: () => void
  label?: string
  /** Other things to offer beside the sign-in button, while nothing is waiting. */
  children?: React.ReactNode
}): JSX.Element {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState('')
  const [code, setCode] = useState<Code | null>(null)
  const [left, setLeft] = useState(0)

  // The id lives in a ref as well as state, because the first event can be
  // handled before the render that follows the answer to the request that
  // started the sign-in. Nothing else is signing in to Twitch from here, so an
  // event arriving before the id is known can only be this one's.
  const current = useRef('')

  useEffect(() => {
    const off = window.moho.onEvent((e) => {
      if (!e.event.startsWith('twitchLogin')) return
      const d = e.data as {
        loginId?: string
        detail?: string
        userCode?: string
        verificationUri?: string
        expiresIn?: number
        scopes?: Scope[]
        success?: boolean
        error?: string
      }
      if (current.current && d.loginId !== current.current) return
      if (e.event === 'twitchLoginCode' && d.userCode && d.verificationUri) {
        setCode({ userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn ?? 1800, scopes: d.scopes ?? ASKS, at: Date.now() })
      } else if (e.event === 'twitchLoginStatus') {
        setDetail(d.detail || '')
      } else if (e.event === 'twitchLoginResult') {
        current.current = ''
        setBusy(false)
        setCode(null)
        setDetail('')
        if (d.success) {
          void store.refreshAccounts()
          onDone()
        } else {
          store.toast('error', d.error || 'Twitch sign-in failed')
        }
      }
    })
    return off
  }, [onDone, store])

  // Closing the form on a sign-in that is still waiting tells the daemon
  // nobody is, so it stops asking Twitch and frees what it was holding.
  useEffect(
    () => () => {
      if (current.current) void window.moho.rpc('cancelTwitchLogin', { loginId: current.current }).catch(() => {})
    },
    []
  )

  // How long the code has left, counted down so nobody types one that has run out.
  useEffect(() => {
    if (!code) return
    const tick = (): void => setLeft(Math.max(0, code.expiresIn - Math.floor((Date.now() - code.at) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [code])

  const begin = (): void => {
    setBusy(true)
    setDetail('')
    current.current = ''
    void window.moho
      .rpc<{ loginId: string }>('startTwitchLogin', { useTor })
      .then((r) => {
        current.current = r.loginId
      })
      .catch((e: Error) => {
        setBusy(false)
        store.toast('error', e.message)
      })
  }

  const cancel = (): void => {
    if (current.current) void window.moho.rpc('cancelTwitchLogin', { loginId: current.current }).catch(() => {})
    current.current = ''
    setBusy(false)
    setCode(null)
    setDetail('')
  }

  if (code) {
    const minutes = Math.floor(left / 60)
    const seconds = String(left % 60).padStart(2, '0')
    return (
      <div className="add-form">
        <p>Approve this on twitch.tv to finish signing in.</p>
        <div className="twitch-code" aria-label="Your sign-in code">
          {code.userCode}
        </div>
        <div className="field-row">
          <button type="button" className="button primary" onClick={() => void window.moho.openExternal(code.verificationUri)}>
            Open twitch.tv
          </button>
          <button type="button" className="button subtle" onClick={() => void window.moho.copyText(code.userCode)}>
            Copy code
          </button>
          <button type="button" className="button" onClick={cancel}>
            Cancel sign-in
          </button>
        </div>
        <p className="small muted">
          The page opens with the code already filled in. If it asks for it, type the code above. It is good for{' '}
          {left > 0 ? `${minutes}:${seconds}` : 'no time at all - start again'}.
        </p>
        <p className="small muted">
          moho will be allowed to: {code.scopes.map((s) => s.why).join(', ')}. You can end it any time at
          twitch.tv/settings/connections, and removing the account here ends it too.
        </p>
        {detail && <p className="small muted">{detail}…</p>}
      </div>
    )
  }

  return (
    <>
      <p className="small muted">
        You sign in on twitch.tv, in your own browser - moho never sees your password. It asks to be allowed to:{' '}
        {ASKS.map((s) => s.why).join(', ')}.
      </p>
      <div className="field-row">
        <button type="button" className="button primary" disabled={busy} onClick={begin}>
          {busy ? 'Asking Twitch…' : label}
        </button>
        {children}
      </div>
      {busy && detail && <p className="small muted">{detail}…</p>}
    </>
  )
}

import { useEffect, useState } from 'react'
import { useStore } from '../state/hooks'

/**
 * Signing in to Twitch.
 *
 * One action. A window of twitch.tv opens; the person signs in there (typed
 * into Twitch's own page, never seen by moho) and then, in the same window,
 * approves what moho is asked to be allowed to do. That gives the account both
 * what Twitch's API takes (chat, follows, moderation) and the session its
 * player takes (video as the person, with their Turbo or subscriptions) -
 * see src/main/twitch-signin.ts and nobilis backend/twitch/login.rs. Waiting
 * can take minutes, so this listens for events while the window is open.
 */
interface Scope {
  scope: string
  why: string
}

/** The scopes the sign-in asks for, said before it is started so nobody has to guess. */
const ASKS: Scope[] = [
  { scope: 'chat:read', why: 'read chat' },
  { scope: 'chat:edit', why: 'send messages' },
  { scope: 'user:write:chat', why: 'hear why Twitch turned a message down' },
  { scope: 'user:read:follows', why: 'list the channels you follow' },
  { scope: 'user:read:emotes', why: 'show the emotes you can use' }
]

/** What turning moderation on adds, said before it is asked for. */
const MODERATION_ASKS: Scope[] = [
  { scope: 'moderator:manage:banned_users', why: 'time out, ban and unban where you moderate' },
  { scope: 'moderator:manage:chat_messages', why: 'remove messages where you moderate' },
  { scope: 'moderator:manage:chat_settings', why: 'change slow, followers-only, subscribers-only and emote-only modes' },
  { scope: 'moderator:manage:announcements', why: 'make announcements' },
  { scope: 'user:manage:chat_color', why: 'change your name colour' },
  { scope: 'user:manage:whispers', why: 'send whispers' },
  { scope: 'whispers:read', why: 'read whispers sent to you' },
  { scope: 'moderator:manage:shoutouts', why: 'give shoutouts where you moderate' },
  { scope: 'user:manage:blocked_users', why: 'block and unblock people' }
]

export function TwitchSignIn({
  useTor,
  onDone,
  label = 'Sign in with Twitch',
  moderation = false,
  children
}: {
  useTor: boolean
  onDone: () => void
  label?: string
  /** Also ask for the rights to moderate and whisper. Only ever on because the person turned it on. */
  moderation?: boolean
  /** Other things to offer beside the sign-in button, while nothing is waiting. */
  children?: React.ReactNode
}): JSX.Element {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState('')
  const [userCode, setUserCode] = useState('')
  const [scopes, setScopes] = useState<Scope[]>(moderation ? [...ASKS, ...MODERATION_ASKS] : ASKS)

  useEffect(() => {
    const off = window.moho.onEvent((e) => {
      if (!busy || !e.event.startsWith('twitchLogin')) return
      const d = e.data as { detail?: string; scopes?: Scope[]; userCode?: string }
      if (e.event === 'twitchLoginCode') {
        if (d.scopes) setScopes(d.scopes)
        if (d.userCode) setUserCode(d.userCode)
      }
      else if (e.event === 'twitchLoginStatus') setDetail(d.detail || '')
    })
    return off
  }, [busy])

  const begin = (): void => {
    setBusy(true)
    setDetail('')
    void window.moho
      .twitchSignIn({ useTor, moderation })
      .then((r) => {
        if (r.ok) {
          store.toast('info', 'Signed in to Twitch for chat and video')
          void store.refreshAccounts()
          onDone()
        } else if (r.error && r.error !== 'cancelled') {
          store.toast('error', r.error)
        }
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => {
        setBusy(false)
        setDetail('')
        setUserCode('')
        void store.refreshAccounts()
      })
  }

  if (busy) {
    return (
      <div className="add-form">
        <p>Sign in on twitch.tv in the window that opened. It then goes to Twitch's "Activate your device" page, where moho types this code in for you; then press Authorize.</p>
        {userCode && (
          <div className="field-row">
            <strong className="twitch-code" aria-label="Your sign-in code">
              {userCode}
            </strong>
            <button type="button" className="button subtle" onClick={() => void window.moho.copyText(userCode)}>
              Copy code
            </button>
          </div>
        )}
        <p className="small muted">
          moho will be allowed to: {scopes.map((s) => s.why).join(', ')}. Twitch lists the same on its own page. You can end it any time at
          twitch.tv/settings/connections, and removing the account here ends it too. Closing the window cancels the sign-in.
        </p>
        {detail && <p className="small muted">{detail}…</p>}
      </div>
    )
  }

  return (
    <>
      <p className="small muted">
        One sign-in on twitch.tv, in a window that opens here: typed on Twitch's own page, never seen by moho. It signs you in for
        chat and for video together, so video plays as you. It asks to be allowed to: {scopes.map((s) => s.why).join(', ')}.
      </p>
      <div className="field-row">
        <button type="button" className="button primary" onClick={begin}>
          {label}
        </button>
        {children}
      </div>
    </>
  )
}

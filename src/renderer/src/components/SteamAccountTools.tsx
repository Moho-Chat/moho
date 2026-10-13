import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import { formatFullTime } from '../lib/util'
import type { Account } from '../../../shared/wire'

/** What Steam says of the account, as the daemon sends it. */
interface Facts {
  limited?: boolean
  familyView?: { enabled: boolean; holdsFriendsBack: boolean } | null
  textFilter?: { on: boolean; setting: string; ignoreFriends: boolean; words: number } | null
  privacy?: { profile?: string; inventory?: string; games?: string; playtime?: string; friends?: string } | null
}

interface Session {
  tokenId: string
  description: string
  platform: number
  lastSeen: number
  place: string
  current: boolean
}

/** Which kind of place a session is, in the words Steam's own list uses. */
function platformLabel(platform: number): string {
  return platform === 3 ? 'Mobile app' : platform === 2 ? 'Web browser' : platform === 1 ? 'Steam client' : 'Signed in'
}

function privacyWord(state?: string | null): string {
  return state === 'public' ? 'public' : state === 'friends' ? 'friends only' : state === 'private' ? 'private' : 'not said'
}

/**
 * What the account is, and where it is signed in.
 *
 * Steam holds things back from an account without saying so where it matters: a
 * limited account cannot write to everybody, Family View can hold the friends
 * list back. Said here in words, with the privacy the account has set, the text
 * filter it uses, and the places it is signed in - any of which, other than the
 * one in use, can be signed out.
 */
export function SteamAccountTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [facts, setFacts] = useState<Facts | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [confirming, setConfirming] = useState('')
  const connected = account.state === 'connected'

  useEffect(() => {
    let live = true
    void window.moho
      .rpc<Facts>('steamAccountFacts', { accountId: account.id })
      .then((f) => live && setFacts(f))
      .catch(() => {})
    const off = window.moho.onEvent((e) => {
      if (e.event !== 'steamAccountFacts') return
      const d = e.data as { accountId?: string; facts?: Facts }
      if (d.accountId === account.id && d.facts) setFacts(d.facts)
    })
    return () => {
      live = false
      off()
    }
  }, [account.id, connected])

  const loadSessions = (): void => {
    void window.moho
      .rpc<Session[]>('steamSessions', { accountId: account.id })
      .then(setSessions)
      .catch((e: Error) => store.toast('error', e.message))
  }

  const signOut = (s: Session): void => {
    setConfirming('')
    void window.moho
      .rpc<Session[]>('steamRevokeSession', { accountId: account.id, tokenId: s.tokenId })
      .then((list) => {
        setSessions(list)
        store.toast('info', `Signed out ${s.description}`)
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  const notes: string[] = []
  if (facts?.limited) {
    notes.push('This is a limited account: Steam stops it from messaging anyone who is not a friend, and from sending files or many links, until it has spent enough on Steam.')
  }
  if (facts?.familyView?.enabled) {
    notes.push(
      facts.familyView.holdsFriendsBack
        ? 'Family View is on and holds friends and chat back. Unlock it in Steam to chat from here.'
        : 'Family View is on. It does not hold friends and chat back.'
    )
  }

  return (
    <div className="sasl-block">
      <span className="small muted">What Steam says about this account</span>
      {!facts && <p className="small muted">{connected ? 'Asking Steam…' : 'Connect the account to read this.'}</p>}
      {notes.map((n) => (
        <div key={n} className="warning-note">
          <Icon name="info" size={16} />
          <span>{n}</span>
        </div>
      ))}
      {facts && !facts.limited && !facts.familyView?.enabled && <p className="small muted">Not limited, and Family View is off.</p>}
      {facts?.privacy && (
        <p className="small muted">
          Privacy: profile {privacyWord(facts.privacy.profile)}, games {privacyWord(facts.privacy.games)}, friends list{' '}
          {privacyWord(facts.privacy.friends)}, inventory {privacyWord(facts.privacy.inventory)}. Changed on Steam, not here.
        </p>
      )}
      {facts?.textFilter && (
        <p className="small muted">
          Text filter: {facts.textFilter.setting}
          {facts.textFilter.on
            ? `. ${facts.textFilter.words > 0 ? `The ${facts.textFilter.words} words you added are hidden` : 'No words of your own are added'}${facts.textFilter.ignoreFriends ? ', for people who are not friends' : ''}. Steam's own list of what to hide is not applied here.`
            : '.'}
        </p>
      )}

      <span className="small muted">Where this account is signed in</span>
      {sessions === null ? (
        <div className="field-row">
          <button type="button" className="button subtle small" disabled={!connected} onClick={loadSessions}>
            Show where it is signed in
          </button>
        </div>
      ) : (
        sessions.map((s) => (
          <div key={s.tokenId} className="field-row">
            <span className="grow">
              {s.description}
              <span className="small muted">
                {' '}
                · {platformLabel(s.platform)}
                {s.place ? ` · ${s.place}` : ''}
                {s.lastSeen ? ` · ${formatFullTime(s.lastSeen)}` : ''}
              </span>
            </span>
            {s.current ? (
              <span className="small muted">this one</span>
            ) : confirming === s.tokenId ? (
              <>
                <button type="button" className="button danger small" onClick={() => signOut(s)}>
                  Sign it out
                </button>
                <button type="button" className="button subtle small" onClick={() => setConfirming('')}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="button subtle small" onClick={() => setConfirming(s.tokenId)}>
                Sign out
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

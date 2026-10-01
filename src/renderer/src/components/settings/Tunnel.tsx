import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { useStore } from '../../state/hooks'

/** The daemon-wide network settings, as getNetSettings reports them. */
export interface NetSettings {
  torMode: 'embedded' | 'proxy'
  proxy: string | null
  tunnelAll: boolean
}

/** Reads the network settings, and refreshes them on request. */
export function useNetSettings(): [NetSettings | null, () => void] {
  const [settings, setSettings] = useState<NetSettings | null>(null)
  const load = (): void => {
    void window.moho
      .rpc<NetSettings>('getNetSettings')
      .then(setSettings)
      // An older daemon has no such method; there is nothing to show then.
      .catch(() => setSettings(null))
  }
  useEffect(load, [])
  return [settings, load]
}

/**
 * Everything through Tor or the proxy, accounts or not.
 *
 * The accounts each have a switch of their own; this is the one that covers
 * what belongs to no account - the request that checks whether a link is a
 * picture, link previews, every image and video the window shows, uploads to
 * a file host. Shown on the first screen as well as in Settings, because the
 * first thing moho does with a new account is fetch things for it, and
 * somebody who needs this needs it before that.
 */
export function TunnelAllSwitch(): JSX.Element | null {
  const store = useStore()
  const [settings, reload] = useNetSettings()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!settings) return null
  const on = settings.tunnelAll

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    setStatus(next ? 'Starting Tor or reaching the proxy…' : null)
    try {
      await window.moho.rpc('setNetSettings', { tunnelAll: next })
      reload()
      if (next) {
        // Asked once so the switch can say whether it worked; the window
        // itself is pointed at the route by the main process either way.
        const answer = await window.moho.rpc<{ socks?: string | null; error?: string }>('netTunnel')
        setStatus(
          answer.socks
            ? 'Everything moho fetches now goes through Tor or the proxy.'
            : `Not reachable yet, so moho is holding everything back rather than sending it directly: ${answer.error ?? 'no route'}`
        )
      }
    } catch (e) {
      store.toast('error', (e as Error).message)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tor-switch">
      <div className="switch-row">
        <div className="switch-text">
          <span>Send all of moho&apos;s traffic through Tor or a SOCKS5 proxy</span>
          <span className="small muted">
            Every account, and everything that belongs to none: checking whether a link is a
            picture, link previews, images and video, uploads. Uses moho&apos;s own Tor, or the
            proxy set in Settings → Tor.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Send all of moho's traffic through Tor or a SOCKS5 proxy"
          className={on ? 'switch on' : 'switch'}
          disabled={busy}
          onClick={() => void toggle(!on)}
        >
          <span className="switch-knob" />
        </button>
      </div>
      {on && (
        <div className="warning-note">
          <Icon name="warning" size={16} />
          <span>
            Many services block Tor&apos;s exit points - Discord and Kick among them, and many IRC
            networks and Matrix homeservers - so accounts on them may stop connecting. A SOCKS5
            proxy you host yourself may be accepted where Tor is not. Pages and pictures load
            more slowly, and calls do not work, since neither Tor nor SOCKS5 carries the UDP they
            need.
          </span>
        </div>
      )}
      {status && <p className="small muted">{status}</p>}
    </div>
  )
}

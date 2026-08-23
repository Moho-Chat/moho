import { useEffect, useState } from 'react'
import {
  ChoiceSetting,
  DirectorySetting,
  SettingsSection,
  SelectionSetting,
  StringSetting,
  ToggleSetting
} from './controls'
import { useChat, useStore } from '../../state/hooks'
import { Icon } from '../Icon'
import type { Account } from '../../../../shared/wire'

/**
 * Structured by service, so adding a protocol later means adding a rail entry
 * and its own panel rather than redesigning this file - a left-hand list of
 * categories swapping a content pane on the right, sized for a handful of
 * protocols rather than dozens of categories (hence no search).
 */
const CATEGORIES = [
  { id: 'general', label: 'General', available: true },
  { id: 'irc', label: 'IRC', available: true },
  { id: 'sockchat', label: 'Sneedchat', available: true },
  { id: 'tor', label: 'Tor', available: true },
  { id: 'matrix', label: 'Matrix', available: true },
  { id: 'daemon', label: 'Daemon', available: true },
  { id: 'discord', label: 'Discord', available: false },
  { id: 'slack', label: 'Slack', available: false }
]

export function SettingsPanel(): JSX.Element {
  const [selected, setSelected] = useState('general')

  return (
    <div className="settings">
      <div className="settings-rail">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`settings-rail-item${selected === c.id ? ' active' : ''}${c.available ? '' : ' soon'}`}
            onClick={() => setSelected(c.id)}
          >
            {c.available ? c.label : `${c.label} (soon)`}
          </button>
        ))}
      </div>

      <div className="divider-v" />

      <div className="settings-content">
        {selected === 'general' && <GeneralSettings />}
        {selected === 'irc' && <IrcSettings />}
        {selected === 'sockchat' && <SneedchatSettings />}
        {selected === 'tor' && <TorSettings />}
        {selected === 'matrix' && <MatrixSettings />}
        {selected === 'daemon' && <DaemonSettings />}
        {(selected === 'discord' || selected === 'slack') && (
          <ComingSoon label={CATEGORIES.find((c) => c.id === selected)!.label} />
        )}
      </div>
    </div>
  )
}

function ComingSoon({ label }: { label: string }): JSX.Element {
  return (
    <SettingsSection
      title={label}
      description="Not connected yet - this gets its own settings here once its backend exists, the same way IRC's does."
    />
  )
}

/**
 * Which microphone and speakers voice uses.
 *
 * These are the daemon's rather than this window's: it holds the connection
 * and does the encoding, so it is the only place that can act on the choice,
 * and a second window has to show the same answer.
 */
function VoiceSettings(): JSX.Element {
  const store = useStore()
  const devices = useChat((s) => s.audioDevices)
  const voice = useChat((s) => s.voicePrefs)

  useEffect(() => {
    void store.refreshAudioDevices()
    void store.refreshVoicePrefs()
  }, [store])

  const listFor = (kind: 'input' | 'output'): { label: string; value: string }[] => [
    // Following the system default is the right behaviour for anyone who has
    // not chosen, and has to stay reachable after they have.
    { label: 'System default', value: '' },
    ...devices
      .filter((d) => d.kind === kind)
      .map((d) => ({ label: d.isDefault ? `${d.name} (default)` : d.name, value: d.id }))
  ]

  const none = devices.length === 0

  return (
    <SettingsSection
      title="Voice"
      description={
        none
          ? "No sound devices were found. Voice needs a running sound server; everything else works without one."
          : 'Used for voice calls. A change takes effect on a call already in progress. Muting is on the status plaque at the foot of the channel list, where it stays reachable during one.'
      }
    >
      <ChoiceSetting
        label="Microphone"
        description="Monitor devices are deliberately not offered: they play back what you are already hearing, which would send the call back into itself."
        value={voice.input ?? ''}
        options={listFor('input')}
        onChange={(id) => void store.setVoiceDevice('input', id)}
        disabled={none}
      />
      <ChoiceSetting
        label="Output"
        value={voice.output ?? ''}
        options={listFor('output')}
        onChange={(id) => void store.setVoiceDevice('output', id)}
        disabled={none}
      />
    </SettingsSection>
  )
}

/**
 * Cross-protocol preferences - these apply to every buffer regardless of
 * backend, unlike the per-protocol message filters.
 */
function GeneralSettings(): JSX.Element {
  const [defaultDir, setDefaultDir] = useState('')
  useEffect(() => {
    void window.moho.defaultDownloadDir().then(setDefaultDir)
  }, [])

  return (
    <>
      <SettingsSection title="Message layout">
        <SelectionSetting
          settingKey="display.messageMode"
          label="Display style"
          description="Classic: a compact IRC-style log, one line per message. Comfy: grouped by author with an avatar and more breathing room."
          defaultValue="classic"
          options={[
            { label: 'Classic', value: 'classic' },
            { label: 'Comfy', value: 'comfy' }
          ]}
        />
        <ToggleSetting
          settingKey="display.relativeTimestamps"
          label="Relative timestamps"
          description='Show "8m ago" instead of a clock time, switching to "Yesterday at 5:27 PM" after 23h and a short date after 47h. Hovering always shows the full date either way.'
          defaultValue={false}
        />
      </SettingsSection>

      <SettingsSection title="Media">
        <ToggleSetting
          settingKey="media.autoplay"
          label="Autoplay GIFs and WebP"
          description="Play animated images as soon as they're shown, instead of waiting for a click"
          defaultValue={true}
        />
        <ToggleSetting
          settingKey="media.loop"
          label="Loop videos"
          description="Keep replaying an inline video instead of stopping after one pass"
          defaultValue={true}
        />
        <ToggleSetting
          settingKey="media.contentSniffing"
          label="Embed unrecognized links by content type"
          description="Many image hosts use short, extensionless links that can't be identified from the URL text alone. When on, an unrecognized link is checked directly and embedded if it turns out to be media. Privacy note: this contacts the linked site the moment a message arrives, not only if you click it - and for Sneedchat it bypasses Tor entirely, since it's a plain network request. Turn off to only embed links with a recognizable file extension."
          defaultValue={true}
        />
      </SettingsSection>

      <SettingsSection title="Downloads">
        <DirectorySetting
          settingKey="downloads.directory"
          label="Save downloads to"
          description="Where the save button in the expanded media viewer puts files. Left unset, this follows your system's downloads folder."
          defaultPath={defaultDir}
        />
      </SettingsSection>

      <VoiceSettings />

      <SettingsSection
        title="Window"
        description="Wayland compositors don't allow an ordinary app to grab keys globally, so this only takes effect under X11. On Wayland, bind your compositor to focus moho instead."
      >
        <StringSetting
          settingKey="hotkey.toggle"
          label="Show/hide hotkey"
          defaultValue="Control+Shift+M"
          placeholder="Control+Shift+M"
        />
      </SettingsSection>
    </>
  )
}

/**
 * Message-kind filters plus connection defaults. nobilis always emits and
 * persists every message regardless of kind - which to render is purely a
 * client decision, so toggling one takes effect immediately without any
 * reconnect or replay.
 */
function IrcSettings(): JSX.Element {
  return (
    <>
      <SettingsSection title="Message filters">
        <ToggleSetting settingKey="irc.showJoinMessages" label="Show join messages" description='"X entered the room"' defaultValue={true} />
        <ToggleSetting
          settingKey="irc.showPartMessages"
          label="Show part/quit messages"
          description='"X left the room" - PART and QUIT read identically once turned into text, so this covers both'
          defaultValue={true}
        />
        <ToggleSetting settingKey="irc.showNickChanges" label="Show nick changes" description='"X is now known as Y"' defaultValue={true} />
        <ToggleSetting settingKey="irc.showTopicChanges" label="Show topic changes" defaultValue={true} />
        <ToggleSetting
          settingKey="irc.showModeChanges"
          label="Show mode changes"
          description="Channel and user mode notices (+o, +m, …) - often noisy on busy channels"
          defaultValue={true}
        />
      </SettingsSection>

      <SettingsSection
        title="Connection defaults for new accounts"
        description="Applied when you connect a new IRC account. SASL, autojoin and NickServ auto-identify are per-account instead, from that account's own entry in the Accounts pane."
      >
        <ToggleSetting settingKey="irc.defaultSsl" label="Use TLS" defaultValue={true} />
        <StringSetting settingKey="irc.quitMessage" label="Quit message" defaultValue="Leaving." />
      </SettingsSection>
    </>
  )
}

/**
 * No server-side "list every room" endpoint exists, so this is the fixed
 * catalogue the account was originally configured against. Adding a room the
 * site actually has just means it can be toggled on here too.
 */
const KNOWN_SOCKCHAT_ROOMS = [
  { id: 1, name: 'general' },
  { id: 8, name: 'gunt' },
  { id: 15, name: 'keno-kasino' },
  { id: 16, name: 'fishtank' },
  { id: 18, name: 'beauty-parlor' },
  { id: 19, name: 'sports' }
]

function useSockchatAccount(): Account | undefined {
  return useChat((s) => s.accounts).find((a) => a.service === 'sockchat')
}

/**
 * Unlike the IRC panel (pure local preferences), this edits an existing
 * account's live backend config - which rooms it stays connected to - so it
 * writes through nobilis rather than the preference store.
 */
function SneedchatSettings(): JSX.Element {
  const store = useStore()
  const account = useSockchatAccount()

  if (!account) {
    return (
      <SettingsSection
        title="Sneedchat"
        description="No Sneedchat account configured yet - add one from the Accounts pane first."
      />
    )
  }

  const enabled = account.sockchatRooms || []
  const setRoom = (id: number, on: boolean): void => {
    const next = on
      ? enabled.some((r) => r.id === id)
        ? enabled
        : [...enabled, KNOWN_SOCKCHAT_ROOMS.find((r) => r.id === id)!]
      : enabled.filter((r) => r.id !== id)
    void window.moho
      .rpc('setSockChatRooms', { accountId: account.id, rooms: next })
      .then(() => store.refreshAccounts())
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <SettingsSection
      title="Channels"
      description="Each enabled channel keeps its own permanent connection - all share one embedded Tor circuit, so enabling more costs very little extra memory."
    >
      {KNOWN_SOCKCHAT_ROOMS.map((room) => (
        <label key={room.id} className="setting-row">
          <div className="setting-text">#{room.name}</div>
          <input
            type="checkbox"
            className="setting-toggle"
            checked={enabled.some((r) => r.id === room.id)}
            onChange={(e) => setRoom(room.id, e.target.checked)}
          />
        </label>
      ))}
      <p className="small muted">
        Sneedchat is Tor-only - see the Tor category for transport and circuit options.
      </p>
    </SettingsSection>
  )
}

/**
 * There is exactly one embedded Tor client shared by the whole daemon, not one
 * per account, so everything here is daemon-global.
 */
function TorSettings(): JSX.Element {
  const store = useStore()
  const account = useSockchatAccount()
  const [useProxy, setUseProxy] = useState(account?.torMode === 'proxy')
  const [proxy, setProxy] = useState(account?.torProxy || '')

  const call = (method: string, params: Record<string, unknown>, note: string): void => {
    void window.moho
      .rpc(method, params)
      .then(() => {
        store.toast('info', note)
        void store.refreshAccounts()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <>
      <SettingsSection
        title="Tor"
        description="Sneedchat is Tor-only. Embedded runs Tor in-process with no setup; an external proxy uses a Tor daemon or Tor Browser you already have running. This applies to every configured Sneedchat account."
      >
        <label className="setting-row">
          <div className="setting-text">Use an external SOCKS5 proxy instead of embedded Tor</div>
          <input
            type="checkbox"
            className="setting-toggle"
            checked={useProxy}
            onChange={(e) => setUseProxy(e.target.checked)}
          />
        </label>
        {useProxy && (
          <input
            className="text-field"
            placeholder="socks5h://127.0.0.1:9050"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
          />
        )}
        <button
          type="button"
          className="button"
          onClick={() =>
            call(
              'setTorConfig',
              { torMode: useProxy ? 'proxy' : 'embedded', proxy: useProxy ? proxy : '' },
              'Connection settings saved - reconnecting…'
            )
          }
        >
          Save connection settings
        </button>
      </SettingsSection>

      <SettingsSection
        title="Circuit"
        description="Regenerate gets a fresh circuit from the cached consensus and guard data (fast). Restart from scratch also wipes that cache for a full cold bootstrap, which can take up to a minute. Both reconnect every Sneedchat account afterward."
      >
        <div className="button-row">
          <button
            type="button"
            className="button subtle"
            onClick={() => call('regenerateTorCircuit', {}, 'Regenerating Tor circuit…')}
          >
            Regenerate circuit
          </button>
          <button
            type="button"
            className="button subtle"
            onClick={() =>
              call('restartTorFromScratch', {}, 'Restarting Tor from scratch - this can take a minute…')
            }
          >
            Restart Tor from scratch
          </button>
        </div>
      </SettingsSection>
    </>
  )
}

/**
 * Deliberately just the membership-announcement toggles. Account-level things
 * (session verification, recovery key, device management) live under each
 * account's own row in the Accounts pane instead - a room-open toggle isn't
 * tied to any one account the way those are.
 */
function MatrixSettings(): JSX.Element {
  return (
    <SettingsSection
      title="Membership announcements"
      description="Shown as chat messages in the room they happened in. nobilis records them regardless of these toggles, so turning one on retroactively reveals events that already happened while it was off."
    >
      <ToggleSetting settingKey="matrix.showJoinMessages" label="Show join messages" description='"X joined the room"' defaultValue={true} />
      <ToggleSetting settingKey="matrix.showInviteMessages" label="Show invite messages" description='"X was invited by Y"' defaultValue={true} />
      <ToggleSetting
        settingKey="matrix.showKickMessages"
        label="Show kick/ban messages"
        description='"X was kicked by Y", including the reason if one was given'
        defaultValue={true}
      />
      <ToggleSetting settingKey="matrix.showQuitMessages" label="Show quit messages" description='"X left the room"' defaultValue={true} />
    </SettingsSection>
  )
}

function DaemonSettings(): JSX.Element {
  const store = useStore()
  const linkUp = useChat((s) => s.linkUp)
  const [status, setStatus] = useState<{ binaryPath: string; available: boolean } | null>(null)

  useEffect(() => {
    void window.moho.daemonStatus().then(setStatus)
  }, [linkUp])

  return (
    <SettingsSection
      title="nobilis"
      description="The background daemon that actually speaks each protocol. It keeps connections, Tor circuits and Matrix sync alive while this window is closed."
    >
      <div className="setting-row">
        <div className="setting-text">
          <div>Status</div>
          <div className="small muted">{status?.binaryPath || '…'}</div>
        </div>
        <span className={`daemon-status${linkUp ? ' up' : ''}`}>
          <Icon name={linkUp ? 'check_circle' : 'cloud_off'} size={15} />
          {linkUp ? 'connected' : 'not connected'}
        </span>
      </div>
      <button
        type="button"
        className="button subtle"
        onClick={() => {
          void window.moho.restartDaemon()
          store.toast('info', 'Restarting nobilis…')
        }}
      >
        Restart daemon
      </button>
      {status && !status.available && (
        <p className="small" style={{ color: 'var(--warning)' }}>
          The nobilis binary wasn&apos;t found. Run <code>cargo build --release</code>, or start nobilis
          yourself.
        </p>
      )}
    </SettingsSection>
  )
}

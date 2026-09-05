import { useEffect, useState } from 'react'
import {
  ChoiceSetting,
  DirectorySetting,
  SettingsSection,
  SelectionSetting,
  StringSetting,
  ToggleSetting
} from './controls'
import { useChat, usePref, useStore } from '../../state/hooks'
import { Icon } from '../Icon'
import type { Account, DccPrefs } from '../../../../shared/wire'

/**
 * The words that count on every account.
 *
 * Not a `StringSetting`, which writes to this window's own preferences: a
 * highlight is decided in the daemon, where it becomes the flag the mentions
 * inbox reads and the notification that reaches a phone. So this reads and
 * writes the daemon's own list, and looks exactly like the settings either
 * side of it.
 */
function GlobalHighlightKeywords(): JSX.Element {
  const store = useStore()
  const [words, setWords] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    void window.moho
      .rpc<{ global: string[] }>('getHighlightKeywords')
      .then((answer) => {
        const text = (answer.global || []).join(', ')
        setWords(text)
        setSaved(text)
      })
      .catch(() => {
        /* An empty box is what somebody with no keywords sees anyway. */
      })
  }, [])

  const commit = (): void => {
    if (words === saved) return
    void window.moho
      .rpc<{ global: string[] }>('setHighlightKeywords', { keywords: words.split(',') })
      // The daemon tidies the list - blanks out, repeats out - so what it
      // says it kept is what the box should show.
      .then((answer) => {
        const text = (answer.global || []).join(', ')
        setWords(text)
        setSaved(text)
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>Words</div>
        <div className="small muted">
          Separated by commas. Whole words only, and case does not matter. They apply to messages
          that arrive after you add them.
        </div>
      </div>
      <input
        className="text-field setting-input"
        value={words}
        placeholder="a project, a surname, a name you also answer to"
        onChange={(e) => setWords(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </div>
  )
}

/**
 * Structured by service, so adding a protocol later means adding a rail entry
 * and its own panel rather than redesigning this file - a left-hand list of
 * categories swapping a content pane on the right, sized for a handful of
 * protocols rather than dozens of categories (hence no search).
 */
const CATEGORIES = [
  { id: 'general', label: 'General', available: true },
  { id: 'irc', label: 'IRC', available: true },
  { id: 'sneedchat', label: 'Sneedchat', available: true },
  { id: 'tor', label: 'Tor', available: true },
  { id: 'matrix', label: 'Matrix', available: true },
  { id: 'kick', label: 'Kick', available: true },
  { id: 'about', label: 'About', available: true },
  { id: 'discord', label: 'Discord', available: false },
  { id: 'slack', label: 'Slack', available: false }
]

/**
 * Where files go on the services that cannot carry them.
 *
 * Neither IRC nor Sneedchat has any idea of an attachment, so sharing a file
 * on either means putting it somewhere and sending the link - which is what
 * people do by hand there anyway. This choice reaches both; it used to reach
 * IRC alone, while a Sneedchat send went to postimg.cc whatever was picked
 * here, and so refused every video. The list comes from
 * the daemon rather than being spelled out here, since the daemon is what
 * performs the upload and a client drawing the menu should not hold a second,
 * separately-maintained copy of the answer.
 */
/**
 * Which host a service sends a file to, for one kind of file.
 *
 * Split two ways because one answer never fitted. By kind, because the hosts
 * differ in what they will take at all - postimg.cc is images-only, so a
 * single choice meant either giving up its click-through page for pictures
 * or having video refused outright. And by service, because the right answer
 * genuinely differs: postimg is the convention on Sneedchat and means nothing
 * on IRC.
 *
 * Only hosts that will accept this kind are offered. Listing one that would
 * refuse the file is how somebody ends up picking it and finding out later.
 */
function UploadHostSetting({
  service,
  kind
}: {
  service: 'irc' | 'sneedchat'
  kind: 'images' | 'media'
}): JSX.Element {
  // The old single setting, kept as the starting point so nobody who chose a
  // host before this was split has to choose it again. Not for media on a
  // host that cannot take any: that would carry a broken choice forward.
  const [legacy] = usePref<string>('uploads.host', '')
  // Carried forward only where it can be honoured: postimg takes images and
  // nothing else, so it is never the answer for media.
  const legacyUsable = legacy === 'postimg' ? kind === 'images' : !!legacy
  const fallback = legacyUsable
    ? legacy
    : kind === 'images' && service === 'sneedchat'
      ? 'postimg'
      : 'catbox'

  const [host, setHost] = usePref<string>(`uploads.${service}.${kind}`, fallback)
  const [hosts, setHosts] = useState<UploadHost[]>([])

  useEffect(() => {
    void window.moho
      .rpc<UploadHost[]>('listUploadHosts')
      .then(setHosts)
      // An older daemon has no such method; the stored choice still applies.
      .catch(() => setHosts([]))
  }, [])

  // Only what will take this kind of file. Every host is available to every
  // service - what differs is how the link is posted once it exists, which
  // is the daemon's business rather than this menu's.
  const usable = hosts.filter((h) => kind === 'images' || !h.imagesOnly)

  return (
    <ChoiceSetting
      label={kind === 'images' ? 'Upload images to' : 'Upload other files to'}
      description={
        kind === 'images'
          ? 'Pictures sent here are uploaded anonymously and the link is posted. A picture this host will not take - postimg.cc refuses avif, for instance - goes to the one below instead.'
          : 'Everything that is not a picture - video, archives, documents. Hosts that only take images are not offered.'
      }
      value={host}
      options={
        usable.length ? usable.map((h) => ({ label: h.label, value: h.id })) : [{ label: host, value: host }]
      }
      onChange={setHost}
    />
  )
}

/** What listUploadHosts reports about somewhere a file can go. */
interface UploadHost {
  id: string
  label: string
  imagesOnly: boolean
}

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
        {selected === 'sneedchat' && <SneedchatSettings />}
        {selected === 'tor' && <TorSettings />}
        {selected === 'matrix' && (
          <>
            <MatrixSettings />
            <MatrixReceiptSettings />
          </>
        )}
        {selected === 'kick' && <KickSettings />}
        {selected === 'about' && <AboutSettings />}
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
          description="Classic: a compact IRC-style log, one line per message. Comfy: grouped by author with an avatar and more breathing room. Bubbles: phone-messaging style, yours on the right in green and theirs on the left in blue, with the time inside each bubble."
          defaultValue="comfy"
          options={[
            { label: 'Classic', value: 'classic' },
            { label: 'Comfy', value: 'comfy' },
            { label: 'Bubbles', value: 'bubbles' }
          ]}
        />
        <ToggleSetting
          settingKey="display.relativeTimestamps"
          label="Relative timestamps"
          description='Show "8m ago" instead of a clock time, switching to "Yesterday at 5:27 PM" after 23h and a short date after 47h. Hovering always shows the full date either way.'
          defaultValue={false}
        />
      </SettingsSection>

      <SettingsSection
        title="Highlight keywords"
        description="Words that light a message up and notify you, the same way your own name does. These apply on every account; an account can add its own in the Accounts pane, for words that only mean you on one network."
      >
        <GlobalHighlightKeywords />
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
          settingKey="irc.renderColours"
          label="Show colours and formatting"
          description="IRC's own bold, italic, underline and colour codes. Off removes them rather than showing the control characters."
          defaultValue={true}
        />
        <ToggleSetting
          settingKey="irc.showModeChanges"
          label="Show mode changes"
          description="Channel and user mode notices (+o, +m, …) - often noisy on busy channels"
          defaultValue={true}
        />
      </SettingsSection>

      <SettingsSection
        title="Uploads"
        description="IRC carries text and nothing else, so a file is uploaded and the link sent - which is what people do by hand there anyway. postimg.cc posts a plain direct link here rather than the BBCode it gets on Sneedchat, since there is no markup on IRC to wrap it in."
      >
        <UploadHostSetting service="irc" kind="images" />
        <UploadHostSetting service="irc" kind="media" />
      </SettingsSection>

      <TransferSettings />

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
 * Receiving files people send over IRC.
 *
 * Backed by the daemon rather than by a stored pref, because the daemon is
 * what writes the files: a download folder held out here would mean a
 * network-driven write aimed by whichever window happened to ask last.
 */
function TransferSettings(): JSX.Element {
  const [prefs, setPrefs] = useState<DccPrefs | null>(null)

  useEffect(() => {
    void window.moho
      .rpc<DccPrefs>('getDccPrefs')
      .then(setPrefs)
      .catch(() => undefined)
  }, [])

  const save = (patch: Partial<DccPrefs>): void => {
    void window.moho
      .rpc<DccPrefs>('setDccPrefs', patch)
      .then(setPrefs)
      .catch(() => undefined)
  }

  return (
    <SettingsSection
      title="XDCC file transfers"
      description="XDCC bots and other people on IRC can offer you a file directly, and you can send one back from a name in the member list or from something they said. Receiving asks first, saves under a name of moho's own choosing rather than theirs, and only ever dials out - which is what lets it work on an account routed through Tor. Sending has to listen instead, so it is refused on such an account rather than quietly giving the address away."
    >
      <div className="setting-row">
        <div className="setting-text">
          <div>Save files to</div>
          <div className="small muted ellipsis">{prefs?.resolvedDirectory ?? '…'}</div>
        </div>
        <div className="setting-actions">
          <button
            type="button"
            className="button"
            onClick={() => void window.moho.pickDirectory().then((dir) => dir && save({ directory: dir }))}
          >
            Browse…
          </button>
          {prefs?.directory && (
            <button type="button" className="button" onClick={() => save({ directory: '' })}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <div>Largest file to accept</div>
          <div className="small muted">
            Anything offered above this is turned down without asking. A sender that goes past what it offered is cut
            off at the same limit.
          </div>
        </div>
        <div className="setting-actions">
          <select
            className="text-field"
            value={String(prefs?.maxBytes ?? 0)}
            onChange={(e) => save({ maxBytes: Number(e.target.value) })}
          >
            {[
              [100 * 1024 * 1024, '100 MB'],
              [1024 * 1024 * 1024, '1 GB'],
              [4 * 1024 * 1024 * 1024, '4 GB'],
              [16 * 1024 * 1024 * 1024, '16 GB'],
              [0, 'No limit']
            ].map(([bytes, label]) => (
              <option key={String(bytes)} value={String(bytes)}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <div>At most this many at once</div>
          <div className="small muted">Further offers are turned down while this many are already going.</div>
        </div>
        <div className="setting-actions">
          <select
            className="text-field"
            value={String(prefs?.maxTransfers ?? 3)}
            onChange={(e) => save({ maxTransfers: Number(e.target.value) })}
          >
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <div>Limit the speed</div>
          <div className="small muted">
            Across every transfer at once, not each. Worth setting where a download at full speed would make the rest
            of the connection unusable - which on a home line is most of them.
          </div>
        </div>
        <div className="setting-actions">
          <select
            className="text-field"
            value={String(prefs?.maxRate ?? 0)}
            onChange={(e) => save({ maxRate: Number(e.target.value) })}
          >
            {[
              [0, 'No limit'],
              [64 * 1024, '64 KB/s'],
              [256 * 1024, '256 KB/s'],
              [512 * 1024, '512 KB/s'],
              [1024 * 1024, '1 MB/s'],
              [5 * 1024 * 1024, '5 MB/s'],
              [20 * 1024 * 1024, '20 MB/s']
            ].map(([bytes, label]) => (
              <option key={String(bytes)} value={String(bytes)}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <div>Address to give out when sending</div>
          <div className="small muted">
            Sending a file means opening a port and telling the other person where to find it. Left blank, moho uses
            the address this machine reaches the server from - which is right on a machine facing the internet and
            wrong behind a router, where the address worth giving out is the one the router answers on.
          </div>
        </div>
        <div className="setting-actions">
          <input
            className="text-field"
            placeholder="automatic"
            defaultValue={prefs?.advertisedIp ?? ''}
            onBlur={(e) => save({ advertisedIp: e.target.value.trim() })}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <div>Accept offers without asking</div>
          {/* Worded so what it gives up is plain rather than implied. The
              limits above still apply - this only removes the question. */}
          <div className="small muted">
            Off by default, and worth leaving off: anyone who can message you can offer you a file, and this takes them
            all. The size and count limits still apply.
          </div>
        </div>
        <div className="setting-actions">
          <input
            type="checkbox"
            checked={prefs?.autoAccept ?? false}
            onChange={(e) => save({ autoAccept: e.target.checked })}
          />
        </div>
      </div>
    </SettingsSection>
  )
}

function useSneedchatAccount(): Account | undefined {
  return useChat((s) => s.accounts).find((a) => a.service === 'sneedchat')
}

/**
 * Sneedchat's own settings are per account and live on the account card.
 *
 * They used to be here, resolved with accounts.find(service === 'sneedchat') -
 * which silently edited the first Sneedchat account and left a second one with
 * no way in at all. Which rooms an account is connected to is part of that
 * account's configuration rather than an application preference, and the
 * daemon has always stored it per account; this pane was the only thing
 * pretending there was one of them.
 */
function SneedchatSettings(): JSX.Element {
  return (
    <>
      <SettingsSection
        title="Sneedchat"
        description="Channels are set per account - open the Accounts pane and expand the account you want. Sneedchat is Tor-only; transport and circuit options are in the Tor category."
      />

      <SettingsSection
        title="Uploads"
        description="Sneedchat's own protocol carries no files at all, so one is uploaded elsewhere and posted as a link. postimg.cc is what the site's regulars use and gives a picture a page to click through to - it takes images only, which is why the two are chosen separately."
      >
        <UploadHostSetting service="sneedchat" kind="images" />
        <UploadHostSetting service="sneedchat" kind="media" />
      </SettingsSection>
    </>
  )
}

/**
 * Kick's chat carries a great deal that nobody said.
 *
 * Redemptions, subscriptions, gifted subs, raids and polls all arrive as
 * events, and on a busy channel they can outnumber the conversation. Each is
 * worth having and not all are worth having at once, so they are separable -
 * the same reasoning as IRC's join and part filters, for the same reason.
 */
function KickSettings(): JSX.Element {
  return (
    <>
      <SettingsSection
        title="Kick"
        description="Channels are watched per account - open the Accounts pane, expand a Kick account and use Sync my follows, or add one by handle with the + beside the account. Kick chat is public, so an account signed out still reads everything."
      />

      <SettingsSection
        title="What to show besides chat"
        description="These are drawn on a plate of their own so they survive being scrolled past, which is also what makes them worth turning off individually."
      >
        <ToggleSetting
          settingKey="kick.showRedemptions"
          label="Show reward redemptions"
          description='"someone redeemed CAT PATS"'
          defaultValue={true}
        />
        <ToggleSetting
          settingKey="kick.showSubscriptions"
          label="Show subscriptions and gifted subs"
          defaultValue={true}
        />
        <ToggleSetting settingKey="kick.showRaids" label="Show raids" defaultValue={true} />
        <ToggleSetting
          settingKey="kick.showPolls"
          label="Show polls"
          description="The question and the running tally, as the streamer changes it"
          defaultValue={true}
        />
        <ToggleSetting
          settingKey="kick.showStreamEvents"
          label="Show going live and going offline"
          defaultValue={true}
        />
        <ToggleSetting
          settingKey="kick.showModeration"
          label="Show timeouts and bans"
          description="What a moderator did, which everybody in the channel can see happening anyway"
          defaultValue={true}
        />
      </SettingsSection>
    </>
  )
}

/**
 * There is exactly one embedded Tor client shared by the whole daemon, not one
 * per account, so everything here is daemon-global.
 */
function TorSettings(): JSX.Element {
  const store = useStore()
  const account = useSneedchatAccount()
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

/**
 * The two halves of read receipts, which are separate choices: whether other
 * people are told where you have got to, and whether you are shown where they
 * have.
 *
 * Turning off sending does not stop moho telling *your own* devices - it sends
 * a private receipt instead of a public one, so a room read here still stops
 * being bold on your phone. Sending nothing at all would have been the
 * simpler code and would have quietly broken that.
 */
function MatrixReceiptSettings(): JSX.Element {
  return (
    <SettingsSection
      title="Read receipts"
      description="Matrix publishes how far each person has read. Both directions are separate: not telling people where you are does not hide where they are."
    >
      <ToggleSetting
        settingKey="matrix.sendReadReceipts"
        label="Let others see what I have read"
        description="Off sends a private receipt instead, so your own other devices still agree about what is unread."
        defaultValue={true}
      />
      <ToggleSetting
        settingKey="matrix.showReadReceipts"
        label="Show who has read each message"
        description="Faces in the right margin, beside the last message each person has reached."
        defaultValue={true}
      />
    </SettingsSection>
  )
}

/**
 * One fact about a build, with its value set in the face a hash wants.
 *
 * Selectable, because the reason to look at a commit is usually to paste it
 * somewhere - into a bug report, or next to `git show`.
 */
function BuildRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div>{label}</div>
      </div>
      <span className="build-value selectable">{value}</span>
    </div>
  )
}

/**
 * What is actually running, and where.
 *
 * The two halves are built and deployed separately and either can be older
 * than the other with nothing looking wrong. An AppImage also keeps running
 * from its own mount after the file on disk has been replaced, so "did my
 * change land" is a real question with no other way to ask it from in here.
 *
 * Commits rather than version numbers, for that reason: the version has not
 * moved in a long time and would answer nothing.
 */
function AboutSettings(): JSX.Element {
  const store = useStore()
  const linkUp = useChat((s) => s.linkUp)
  const [status, setStatus] = useState<{ binaryPath: string; available: boolean } | null>(null)
  const [daemon, setDaemon] = useState<{ version: string; commit: string } | null>(null)

  useEffect(() => {
    void window.moho.daemonStatus().then(setStatus)
    void window.moho
      .rpc<{ version: string; commit: string }>('version')
      .then(setDaemon)
      // A daemon too old to answer cannot say - which is itself the useful
      // answer, since it means the two are out of step.
      .catch(() => setDaemon(null))
  }, [linkUp])

  return (
    <>
      <SettingsSection title="moho" description="This window - the client you are looking at.">
        <BuildRow label="Version" value={__APP_VERSION__} />
        <BuildRow label="Build" value={__BUILD_COMMIT__} />
        <BuildRow label="Built" value={new Date(__BUILD_DATE__).toLocaleString()} />
      </SettingsSection>

      <SettingsSection
        title="nobilis"
        description="The background daemon that actually speaks each protocol. It keeps connections, Tor circuits and Matrix sync alive while this window is closed."
      >
        <BuildRow label="Version" value={daemon?.version ?? (linkUp ? 'not reported' : '\u2014')} />
        <BuildRow label="Build" value={daemon?.commit ?? (linkUp ? 'older than this client' : '\u2014')} />
        <div className="setting-row">
          <div className="setting-text">
            <div>Status</div>
            <div className="small muted">{status?.binaryPath || '\u2026'}</div>
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
            store.toast('info', 'Restarting nobilis\u2026')
          }}
        >
          Restart daemon
        </button>
        {status && !status.available && (
          <p className="small" style={{ color: 'var(--warning)' }}>
            The nobilis binary wasn&apos;t found. Run <code>cargo build --release</code>, or start
            nobilis yourself.
          </p>
        )}
      </SettingsSection>
    </>
  )
}

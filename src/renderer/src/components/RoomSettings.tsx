import { useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { HeaderPopover } from './HeaderPopover'
import { ChoiceSetting } from './settings/controls'
import { useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/** What the daemon says about one of a room's settings. */
interface Choice {
  value: string
  choices: string[]
  canChange: boolean
}

/** What room version this room is on, and whether it is worth moving. */
interface Version {
  current: string
  default: string
  behind: boolean
  canUpgrade: boolean
}

/** One entry of a published ban list. */
interface PolicyRule {
  about: string
  entity: string
  recommendation: string
  reason: string
}

/** What a room refuses, and whose judgement it follows. */
interface Policy {
  serverAcl: { present: boolean; allow: string[]; deny: string[]; allowIpLiterals: boolean }
  policyServer: string | null
  rules: PolicyRule[]
  canChange: boolean
}

/**
 * The settings a room keeps about itself.
 *
 * Matrix room state, as opposed to the account's own preferences: these
 * belong to the room and change it for everybody in it, which is why they are
 * here rather than in the settings panel and why each one says whether this
 * account may actually change it.
 *
 * Read when the panel opens rather than held. They change rarely and are
 * looked at rarely, and a value fetched at the moment it is shown cannot be
 * stale - which matters more here than elsewhere, since somebody opening this
 * is usually checking what is true rather than browsing.
 */
export function RoomSettings({ buffer }: { buffer: BufferEntry }): JSX.Element {
  const store = useStore()
  const button = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Choice | null>(null)
  const [version, setVersion] = useState<Version | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [confirmUpgrade, setConfirmUpgrade] = useState(false)
  const [saving, setSaving] = useState(false)
  /**
   * The room's moderation state, and whether anybody has asked for it.
   *
   * Behind a second press rather than loaded with the panel: it needs the
   * room's whole state, which on a large room is a big answer to a question
   * almost nobody is asking. `null` means "not asked"; a loaded object means
   * asked and answered.
   */
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [denying, setDenying] = useState('')

  const load = (): void => {
    setHistory(null)
    setVersion(null)
    setConfirmUpgrade(false)
    setPolicy(null)
    setPolicyOpen(false)
    void window.moho
      .rpc<Choice>('matrixHistoryVisibility', { bufferId: buffer.id })
      .then(setHistory)
      .catch((e: Error) => store.toast('error', e.message))
    void window.moho
      .rpc<Version>('matrixRoomVersion', { bufferId: buffer.id })
      .then(setVersion)
      // Quietly. A room whose version is not known yet is a room with
      // nothing to say here, not an error to put in front of somebody who
      // came to change something else.
      .catch(() => setVersion(null))
  }

  const show = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    load()
  }

  const setHistoryVisibility = (value: string): void => {
    const before = history
    setHistory(history ? { ...history, value } : null)
    setSaving(true)
    void window.moho
      .rpc('setMatrixHistoryVisibility', { bufferId: buffer.id, value })
      .then(() => store.toast('info', `New members can now read ${readableAs(value)}`))
      .catch((e: Error) => {
        setHistory(before)
        store.toast('error', `Couldn't change that: ${e.message}`)
      })
      .finally(() => setSaving(false))
  }

  /**
   * Refusing a server, or letting it back in.
   *
   * Only the deny list is offered. The allow list is the half that can shut a
   * room to its own members, in a way that then cannot be undone from inside
   * it - the daemon refuses to write an empty one, and there is no control
   * here that would try.
   */
  const deny = async (server: string, denied: boolean): Promise<void> => {
    try {
      await window.moho.rpc('setMatrixServerDenied', { bufferId: buffer.id, server, denied })
      setDenying('')
      setPolicy(await window.moho.rpc<Policy>('matrixRoomPolicy', { bufferId: buffer.id }))
      store.toast('info', denied ? `${server} is refused here` : `${server} is allowed again`)
    } catch (e) {
      store.toast('error', `Couldn’t change that: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <span ref={button} className="header-anchor">
        <IconButton
          name="tune"
          title="What this room keeps"
          className={open ? 'active' : undefined}
          onClick={show}
        />
      </span>
      {open && (
        <HeaderPopover anchor={button.current} width={400} onClose={() => setOpen(false)}>
          <div className="small muted">This room&apos;s settings</div>
          {history === null && <div className="small muted">Looking…</div>}
          {history && (
            <>
              <ChoiceSetting
                label="Who can read the past"
                description={
                  history.canChange
                    ? 'Applies from now on. What has already been said keeps the rule it was said under.'
                    : 'Only somebody who can change this room’s settings can change this.'
                }
                value={history.value}
                options={history.choices.map((value) => ({ label: historyLabel(value), value }))}
                disabled={!history.canChange || saving}
                onChange={setHistoryVisibility}
              />
              {/* Worth saying plainly rather than leaving to the wording of
                  the option: this is the one room setting here with a
                  consequence somebody may not expect, and "world readable"
                  really does mean anybody at all. */}
              {history.value === 'world_readable' && (
                <div className="small muted">
                  Anyone can read this room without joining it, including people with no account.
                </div>
              )}
            </>
          )}

          {/* What the room refuses, and whose judgement it follows. Behind
              its own press because reading it needs the room's whole state -
              a big answer on a large room, to a question almost nobody is
              asking, but the only answer there is when somebody does ask why
              a message from another server never arrived. */}
          <div className="setting-row">
            <div className="setting-text">
              <div>Moderation</div>
              <div className="small muted">
                Which servers this room takes events from, and any ban lists it publishes.
              </div>
            </div>
            {!policyOpen && (
              <button
                type="button"
                className="button subtle"
                onClick={() => {
                  setPolicyOpen(true)
                  void window.moho
                    .rpc<Policy>('matrixRoomPolicy', { bufferId: buffer.id })
                    .then(setPolicy)
                    .catch((e: Error) => {
                      store.toast('error', e.message)
                      setPolicyOpen(false)
                    })
                }}
              >
                Show
              </button>
            )}
          </div>

          {policyOpen && !policy && <div className="small muted">Reading the room…</div>}

          {policy && (
            <>
              {/* "No ACL" and "an ACL that allows everything" behave the same
                  and mean different things - one is a room nobody has had to
                  think about, the other is a decision. */}
              {!policy.serverAcl.present ? (
                <div className="small muted">
                  No server ACL. Every server this room federates with can take part.
                </div>
              ) : (
                <>
                  <div className="small muted">
                    Allowed: {policy.serverAcl.allow.join(', ') || '(nobody — this room is closed)'}
                    {!policy.serverAcl.allowIpLiterals && ' · servers named by IP address are refused'}
                  </div>
                  {policy.serverAcl.deny.map((server) => (
                    <div key={server} className="device-row">
                      <Icon name="block" size={18} color="var(--warning)" />
                      <div className="setting-text">
                        <div className="ellipsis">{server}</div>
                      </div>
                      {policy.canChange && (
                        <button
                          type="button"
                          className="button subtle"
                          onClick={() => void deny(server, false)}
                        >
                          Allow again
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}

              {policy.canChange && (
                <div className="field-row">
                  <input
                    className="text-field"
                    placeholder="Refuse a server, by name"
                    value={denying}
                    onChange={(e) => setDenying(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && denying.trim() && void deny(denying.trim(), true)}
                  />
                  <button
                    type="button"
                    className="button subtle"
                    disabled={!denying.trim()}
                    onClick={() => void deny(denying.trim(), true)}
                  >
                    Refuse it
                  </button>
                </div>
              )}

              {policy.policyServer && (
                <div className="small muted">
                  Events in this room are vetted by {policy.policyServer}.
                </div>
              )}

              {policy.rules.length > 0 && (
                <>
                  <div className="small muted">
                    This room publishes {policy.rules.length}{' '}
                    {policy.rules.length === 1 ? 'rule' : 'rules'} for others to follow.
                  </div>
                  {policy.rules.map((rule) => (
                    <div key={`${rule.about}:${rule.entity}`} className="device-row">
                      <Icon name="gavel" size={18} />
                      <div className="setting-text">
                        <div className="ellipsis">{rule.entity}</div>
                        <div className="small muted ellipsis">
                          {rule.about}
                          {rule.reason ? ` — ${rule.reason}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* Not a setting: an upgrade makes a new room and leaves a
              tombstone pointing at it. Offered only where there is somewhere
              to go and somebody who can make the tombstone - and with what
              it costs written out, because the conversation does not come
              with it. */}
          {version?.behind && version.canUpgrade && (
            <div className="setting-row">
              <div className="setting-text">
                <div>Room version {version.current}</div>
                <div className="small muted">
                  {confirmUpgrade
                    ? `This makes a new room on version ${version.default} and leaves a pointer here. The conversation above stays in this room, and the people in it move across as their clients notice.`
                    : `This server now makes rooms on version ${version.default}.`}
                </div>
              </div>
              {confirmUpgrade ? (
                <button
                  type="button"
                  className="button danger"
                  disabled={upgrading}
                  onClick={() => {
                    setUpgrading(true)
                    void window.moho
                      .rpc<{ roomId: string }>('upgradeMatrixRoom', { bufferId: buffer.id })
                      .then(() => {
                        store.toast('info', 'Upgraded — the new room is in your list')
                        setOpen(false)
                      })
                      .catch((e: Error) => store.toast('error', `Couldn’t upgrade: ${e.message}`))
                      .finally(() => setUpgrading(false))
                  }}
                >
                  Upgrade it
                </button>
              ) : (
                <button type="button" className="button subtle" onClick={() => setConfirmUpgrade(true)}>
                  Upgrade…
                </button>
              )}
            </div>
          )}
        </HeaderPopover>
      )}
    </>
  )
}

/**
 * The spec's four values as a sentence about people rather than as protocol
 * words.
 *
 * "shared" and "invited" say nothing on their own - they are the names of
 * rules, not descriptions of them - and this is a setting somebody gets wrong
 * once and cannot take back, because it only ever applies from now on.
 */
function historyLabel(value: string): string {
  switch (value) {
    case 'world_readable':
      return 'Anyone, without joining'
    case 'shared':
      return 'Everything, once they join'
    case 'invited':
      return 'From when they were invited'
    case 'joined':
      return 'Only from when they joined'
    default:
      // A value this client does not know is shown as itself. Quietly
      // relabelling somebody's setting would be worse than admitting it.
      return value
  }
}

/** The same thing said as the end of a sentence, for the toast. */
function readableAs(value: string): string {
  switch (value) {
    case 'world_readable':
      return 'this room without joining it'
    case 'shared':
      return 'everything said before they joined'
    case 'invited':
      return 'what was said after they were invited'
    case 'joined':
      return 'only what is said after they join'
    default:
      return value
  }
}

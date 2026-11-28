import { useEffect, useState } from 'react'
import type React from 'react'
import type { Account, MatrixInvite } from '../../../shared/wire'
import { useStore } from '../state/hooks'

/**
 * Google Chat's own account tools: custom status & DND, starting a DM by email or user ID,
 * creating a Space, and answering pending Space invitations.
 */
/** One tool: what it is, a line on what it does, and its controls under them, full width. */
function Tool({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="googlechat-tool">
      <div className="setting-text">
        <div>{title}</div>
        <div className="small muted">{hint}</div>
      </div>
      {children}
    </div>
  )
}

export function GoogleChatAccountTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [statusEmoji, setStatusEmoji] = useState('')
  const [statusText, setStatusText] = useState('')
  const [dnd, setDnd] = useState(account.status === 'dnd')
  const [dmTarget, setDmTarget] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [spaceDesc, setSpaceDesc] = useState('')
  const [spaceQuery, setSpaceQuery] = useState('')
  const [spaces, setSpaces] = useState<Array<{ spaceId: string; name: string; memberCount: number; joined: boolean }>>([])
  const [invites, setInvites] = useState<MatrixInvite[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const connected = account.state === 'connected'

  const call = <T,>(action: string, params: Record<string, unknown> = {}): Promise<T> =>
    window.moho.rpc<T>('googlechat', { action, accountId: account.id, ...params })

  const loadInvites = async (): Promise<void> => {
    if (!connected) return
    try {
      const r = await call<{ invites: MatrixInvite[] }>('listInvites')
      setInvites(r.invites ?? [])
    } catch {
      // Ignore while connecting.
    }
  }

  useEffect(() => {
    void loadInvites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, connected])

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setNote(null)
    try {
      await fn()
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="account-tools">
      {!connected && <p className="small muted">Connect this Google Chat account to change status, start a DM, or create a Space.</p>}

      <Tool title="Custom status" hint="Shown next to your name in Google Chat. Leave blank to clear.">
        <div className="field-row">
          <input
            type="text"
            value={statusEmoji}
            onChange={(e) => setStatusEmoji(e.target.value)}
            placeholder="😀"
            className="text-field googlechat-emoji"
            disabled={!connected || busy !== null}
          />
          <input
            type="text"
            className="text-field"
            value={statusText}
            onChange={(e) => setStatusText(e.target.value)}
            placeholder="In a meeting"
            disabled={!connected || busy !== null}
          />
          <button
            type="button" className="button subtle"
            disabled={!connected || busy !== null}
            onClick={() =>
              void run('status', async () => {
                await call('setCustomStatus', { text: statusText, emoji: statusEmoji || undefined })
                setNote(statusText.trim() || statusEmoji.trim() ? 'Custom status updated.' : 'Custom status cleared.')
              })
            }
          >
            Save
          </button>
        </div>
      </Tool>

      <Tool title="Do Not Disturb" hint="Mutes Google Chat notifications across your devices.">
        <button
          type="button" className="button subtle"
          disabled={!connected || busy !== null}
          onClick={() =>
            void run('dnd', async () => {
              const next = !dnd
              await call('setDnd', { dnd: next })
              setDnd(next)
              setNote(next ? 'Do Not Disturb enabled.' : 'Do Not Disturb turned off.')
            })
          }
        >
          {dnd ? 'Turn off DND' : 'Turn on DND'}
        </button>
      </Tool>

      <Tool title="Start a direct message" hint="Enter a Google email address or numeric Google Chat user ID.">
        <div className="field-row">
          <input
            type="text"
            className="text-field"
            value={dmTarget}
            onChange={(e) => setDmTarget(e.target.value)}
            placeholder="name@example.com"
            disabled={!connected || busy !== null}
          />
          <button
            type="button" className="button subtle"
            disabled={!connected || !dmTarget.trim() || busy !== null}
            onClick={() =>
              void run('dm', async () => {
                const r = await call<{ bufferId?: string }>('createDm', { target: dmTarget.trim() })
                setDmTarget('')
                if (r.bufferId) store.selectBuffer(r.bufferId)
                setNote('Direct message opened.')
              })
            }
          >
            Open DM
          </button>
        </div>
      </Tool>

      <Tool title="Create a Space" hint="Create a new Google Chat Space with an optional description.">
        <div className="field-row">
          <input
            type="text"
            className="text-field"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            placeholder="Space name"
            disabled={!connected || busy !== null}
          />
          <input
            type="text"
            className="text-field"
            value={spaceDesc}
            onChange={(e) => setSpaceDesc(e.target.value)}
            placeholder="Description (optional)"
            disabled={!connected || busy !== null}
          />
          <button
            type="button" className="button subtle"
            disabled={!connected || !spaceName.trim() || busy !== null}
            onClick={() =>
              void run('space', async () => {
                const r = await call<{ bufferId?: string }>('createSpace', {
                  name: spaceName.trim(),
                  description: spaceDesc.trim() || undefined
                })
                setSpaceName('')
                setSpaceDesc('')
                if (r.bufferId) store.selectBuffer(r.bufferId)
                setNote('Space created.')
              })
            }
          >
            Create
          </button>
        </div>
      </Tool>

      {invites.length > 0 && (
        <Tool title="Pending Space invitations" hint="Invitations received during this session.">
          <div className="googlechat-tool-list">
            {invites.map((inv) => (
              <div key={inv.roomId} className="device-row">
                <span className="setting-text">{inv.name}</span>
                <button
                  type="button" className="button subtle"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('accept', async () => {
                      await call('acceptInvite', { spaceId: inv.roomId })
                      await loadInvites()
                    })
                  }
                >
                  Accept
                </button>
                <button
                  type="button" className="button subtle"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('decline', async () => {
                      await call('declineInvite', { spaceId: inv.roomId })
                      await loadInvites()
                    })
                  }
                >
                  Decline
                </button>
              </div>
            ))}
          </div>
        </Tool>
      )}

      <Tool title="Browse Spaces" hint="Search discoverable or joined Google Chat Spaces.">
        <div className="googlechat-tool-list">
          <div className="field-row">
            <input
              type="text"
            className="text-field"
              value={spaceQuery}
              onChange={(e) => setSpaceQuery(e.target.value)}
              placeholder="Filter Spaces (optional)"
              disabled={!connected || busy !== null}
            />
            <button
              type="button" className="button subtle"
              disabled={!connected || busy !== null}
              onClick={() =>
                void run('browse', async () => {
                  const r = await call<{ spaces: Array<{ spaceId: string; name: string; memberCount: number; joined: boolean }> }>('browseSpaces', {
                    query: spaceQuery.trim()
                  })
                  setSpaces(r.spaces ?? [])
                  if (!r.spaces?.length) setNote('No Spaces matched.')
                })
              }
            >
              Browse
            </button>
          </div>
          {spaces.length > 0 && (
            <div className="googlechat-tool-list">
              {spaces.map((s) => (
                <div key={s.spaceId} className="device-row">
                  <span className="setting-text">
                    {s.name} <span className="small muted">· {s.memberCount} member{s.memberCount === 1 ? '' : 's'}</span>
                  </span>
                  {s.joined ? (
                    <span className="small muted">Joined</span>
                  ) : (
                    <button
                      type="button" className="button subtle"
                      disabled={busy !== null}
                      onClick={() =>
                        void run('join', async () => {
                          const r = await call<{ bufferId?: string }>('joinSpace', { spaceId: s.spaceId })
                          if (r.bufferId) store.selectBuffer(r.bufferId)
                          setNote(`Joined ${s.name}.`)
                        })
                      }
                    >
                      Join
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Tool>

      <Tool title="Google Meet" hint="Start a new Google Meet call inside a Moho window signed in with this account.">
        <button type="button" className="button subtle" onClick={() => void window.moho.openMeetCall('https://meet.google.com/new', account.id)}>
          New Meet call
        </button>
      </Tool>

      {note && <p className="small muted">{note}</p>}
    </div>
  )
}

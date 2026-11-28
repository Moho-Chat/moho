import { useEffect, useState } from 'react'
import type { Account, MatrixInvite } from '../../../shared/wire'
import { useStore } from '../state/hooks'

/**
 * Google Chat's own account tools: custom status & DND, starting a DM by email or user ID,
 * creating a Space, and answering pending Space invitations.
 */
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
      {!connected && <p className="hint">Connect this Google Chat account to change status, start a DM, or create a Space.</p>}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Custom status</div>
          <div className="setting-hint">Shown next to your name in Google Chat. Leave blank to clear.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={statusEmoji}
            onChange={(e) => setStatusEmoji(e.target.value)}
            placeholder="😀"
            style={{ width: 48, textAlign: 'center' }}
            disabled={!connected || busy !== null}
          />
          <input
            type="text"
            value={statusText}
            onChange={(e) => setStatusText(e.target.value)}
            placeholder="In a meeting"
            disabled={!connected || busy !== null}
          />
          <button
            className="btn-secondary"
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
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Do Not Disturb</div>
          <div className="setting-hint">Mutes Google Chat notifications across your devices.</div>
        </div>
        <button
          className="btn-secondary"
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
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Start a direct message</div>
          <div className="setting-hint">Enter a Google email address or numeric Google Chat user ID.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={dmTarget}
            onChange={(e) => setDmTarget(e.target.value)}
            placeholder="name@example.com"
            disabled={!connected || busy !== null}
          />
          <button
            className="btn-secondary"
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
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Create a Space</div>
          <div className="setting-hint">Create a new Google Chat Space with an optional description.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            placeholder="Space name"
            disabled={!connected || busy !== null}
          />
          <input
            type="text"
            value={spaceDesc}
            onChange={(e) => setSpaceDesc(e.target.value)}
            placeholder="Description (optional)"
            disabled={!connected || busy !== null}
          />
          <button
            className="btn-secondary"
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
      </div>

      {invites.length > 0 && (
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Pending Space invitations</div>
            <div className="setting-hint">Invitations received during this session.</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {invites.map((inv) => (
              <div key={inv.roomId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>{inv.name}</span>
                <button
                  className="btn-secondary"
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
                  className="btn-secondary"
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
        </div>
      )}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Browse Spaces</div>
          <div className="setting-hint">Search discoverable or joined Google Chat Spaces.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={spaceQuery}
              onChange={(e) => setSpaceQuery(e.target.value)}
              placeholder="Filter Spaces (optional)"
              disabled={!connected || busy !== null}
            />
            <button
              className="btn-secondary"
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
              {spaces.map((s) => (
                <div key={s.spaceId} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span>
                    {s.name} ({s.memberCount})
                  </span>
                  {s.joined ? (
                    <span className="hint">Joined</span>
                  ) : (
                    <button
                      className="btn-secondary"
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
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Google Meet</div>
          <div className="setting-hint">Start a new Google Meet call inside a Moho window signed in with this account.</div>
        </div>
        <button className="btn-secondary" onClick={() => void window.moho.openMeetCall('https://meet.google.com/new', account.id)}>
          New Meet call
        </button>
      </div>

      {note && <p className="hint">{note}</p>}
    </div>
  )
}

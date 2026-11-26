import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { VoiceMemberRow, type VoiceModPowers } from './VoiceMemberRow'
import { useChat, useStore } from '../state/hooks'

/**
 * Who is in a Stoat or Fluxer voice channel, listed under it in the channel
 * list as a Discord server's are: what anybody decides on before joining.
 * Shares VoiceMemberRow with Discord so hover previews and right-click menus
 * behave consistently across all Discord-format protocols.
 */
export function StoatVoiceWho({
  bufferId,
  accountId,
  channelName
}: {
  bufferId: string
  accountId: string
  channelName: string
}): JSX.Element | null {
  const store = useStore()
  const members = useChat((s) => s.stoatVoice[bufferId]) ?? []
  const activeCall = useChat((s) => s.activeCall)
  const account = useChat((s) => s.accounts.find((a) => a.id === accountId))
  const [powers, setPowers] = useState<VoiceModPowers>({})
  const inChannel = activeCall?.bufferId === bufferId
  const service = account?.service ?? (accountId.startsWith('fluxer:') ? 'fluxer' : 'stoat')

  useEffect(() => {
    setPowers({})
    if (members.length === 0) return
    let alive = true
    void window.moho
      .rpc<VoiceModPowers>('getStoatPowers', { bufferId })
      .then((p) => {
        if (alive && p) setPowers(p)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [bufferId, members.length > 0])

  if (members.length === 0) return null

  const tiles = inChannel ? store.callTiles() : []

  const moderateUser = (userId: string, nick: string, action: 'kick' | 'ban' | 'mute'): void => {
    void window.moho
      .rpc('moderateStoatMember', { bufferId, userId, action, minutes: 10 })
      .then(() =>
        store.toast(
          'info',
          `${action === 'ban' ? 'Banned' : action === 'mute' ? 'Muted for 10 minutes' : 'Removed'} ${nick}`
        )
      )
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <>
      {members.map((m) => {
        const isSelf =
          m.isSelf ?? (!!account?.displayName && m.name === account.displayName)
        const tile = inChannel ? tiles.find((t) => t.userId === m.userId && t.hasVideo) : undefined
        return (
          <VoiceMemberRow
            key={m.userId}
            accountId={accountId}
            service={service}
            userId={m.userId}
            nick={m.name}
            avatarUrl={m.avatarUrl ?? undefined}
            isSelf={isSelf}
            speaking={inChannel && !!tiles.find((t) => t.userId === m.userId && t.speaking)}
            muted={m.muted}
            streaming={m.screen}
            video={m.camera}
            channelName={channelName}
            inChannel={inChannel}
            profileBufferId={bufferId}
            supportsUserVolume
            liveVideoStream={tile?.stream ?? null}
            streamPreviewKey={service === 'fluxer' && m.screen ? `${bufferId}|${m.userId}` : undefined}
            fetchStreamPreview={
              // Fluxer keeps a picture of every shared screen; Stoat keeps none.
              service === 'fluxer' && m.screen && !isSelf
                ? () =>
                    window.moho
                      .rpc<{ url?: string | null }>('fluxerStreamPreview', { bufferId, userId: m.userId })
                      .then((r) => r?.url ?? null)
                : undefined
            }
            onWatchStream={
              m.screen && !isSelf
                ? () => {
                    if (inChannel) void store.selectBuffer(bufferId, false)
                    else void store.joinStoatCall(bufferId, false)
                  }
                : undefined
            }
            onDisconnectSelf={inChannel ? () => store.hangUpMatrixCall() : undefined}
            perms={powers}
            onModerate={(action) => moderateUser(m.userId, m.name, action)}
          >
            {m.screen && (
              <span className="voice-state" title={`${m.name} is sharing a screen`}>
                <Icon name="screen_share" size={13} />
              </span>
            )}
            {m.camera && (
              <span className="voice-state" title={`${m.name} has a camera on`}>
                <Icon name="videocam" size={13} />
              </span>
            )}
            {m.muted && (
              <span className="voice-state" title={`${m.name} is muted`}>
                <Icon name="mic_off" size={13} />
              </span>
            )}
          </VoiceMemberRow>
        )
      })}
    </>
  )
}

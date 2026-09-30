import { useEffect } from 'react'
import { useChat, useStore } from '../../state/hooks'
import { StageWindow } from './StageWindow'
import { CallStage } from '../CallStage'
import { DiscordStage } from '../CallView'

/**
 * Whichever call is happening, in its own window, while it is popped out.
 *
 * One window for one call: a Matrix call if there is one - its media lives in
 * this renderer and has nowhere else to go - and otherwise the Discord call.
 * When the call ends the window goes with it.
 */
export function CallWindowHost(): JSX.Element | null {
  const store = useStore()
  const poppedOut = useChat((s) => s.callPoppedOut)
  const matrix = useChat((s) => s.activeCall)
  const sessions = useChat((s) => s.voiceSessions)
  const discord = sessions[0]
  const anything = !!matrix || !!discord

  useEffect(() => {
    if (poppedOut && !anything) store.setCallPoppedOut(false)
  }, [poppedOut, anything, store])

  if (!poppedOut || !anything) return null
  return (
    <StageWindow onClosed={() => store.setCallPoppedOut(false)}>
      {matrix ? <CallStage mode="window" /> : discord ? <DiscordStage session={discord} where="window" /> : null}
    </StageWindow>
  )
}

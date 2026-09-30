/**
 * Whether a capture is actually producing a picture.
 *
 * A screen opened through the desktop portal on Wayland is handed back as a
 * live track at once - before anybody has answered the portal's own "what do
 * you want to share" window - and if that window is cancelled, or never
 * noticed, the track stays live for ever and delivers nothing. It does not
 * end and it does not fail. So a returned stream says nothing about whether
 * there is a screen behind it; only a frame does.
 *
 * Resolves true on the first frame and false if the track ends or nothing
 * arrives in time, which is what "the person backed out" looks like from
 * here. The time allowed is a person's time - they are choosing a window -
 * not a network's.
 */
export function firstFrame(stream: MediaStream, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const track = stream.getVideoTracks()[0]
    if (!track) return resolve(false)

    const probe = document.createElement('video')
    probe.muted = true
    probe.srcObject = stream

    let settled = false
    const finish = (arrived: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      track.removeEventListener('ended', onEnded)
      probe.srcObject = null
      resolve(arrived)
    }
    const onEnded = (): void => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    track.addEventListener('ended', onEnded)

    if (probe.requestVideoFrameCallback) probe.requestVideoFrameCallback(() => finish(true))
    else probe.onloadeddata = () => finish(true)
    void probe.play().catch(() => {})
  })
}

/** How long somebody is given to choose what to share. */
export const SCREEN_CHOICE_MS = 60_000

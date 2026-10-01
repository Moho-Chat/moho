import { useEffect, useRef, useState } from 'react'
import type { AnimationItem } from 'lottie-web'
import { resolveMediaUrl } from '../lib/util'

/**
 * A Discord Lottie sticker: a vector animation played from the JSON it is.
 *
 * Most of Discord's own sticker packs are these, and they have no still image
 * to fall back on, so without this they were names where pictures should be.
 *
 * The daemon fetches and keeps the file - Discord's CDN sends no CORS header,
 * so a page cannot read it - and this plays it from disk. Nothing is fetched
 * until the sticker is on screen: a picker holds hundreds of them.
 *
 * The light player, which ignores expressions rather than running them: they
 * need eval, which this window does not allow. A sticker that uses one draws
 * that property's static value, which is very nearly the sticker.
 */
export function LottieSticker({
  accountId,
  stickerId,
  size,
  play,
  label
}: {
  accountId: string
  stickerId: string
  size: number
  /** Always moving, moving while hovered, or held on its first frame. */
  play: 'always' | 'hover' | 'never'
  label: string
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const anim = useRef<AnimationItem | null>(null)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        seen.disconnect()
      }
    })
    seen.observe(el)
    return () => seen.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let live = true
    void (async () => {
      try {
        const [{ default: lottie }, data] = await Promise.all([
          import('lottie-web/build/player/lottie_light'),
          animationData(accountId, stickerId)
        ])
        if (!live || !box.current) return
        anim.current = lottie.loadAnimation({
          container: box.current,
          renderer: 'svg',
          loop: true,
          autoplay: play === 'always',
          animationData: data
        })
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
      anim.current?.destroy()
      anim.current = null
    }
  }, [visible, accountId, stickerId, play])

  return (
    <div
      ref={box}
      className="lottie-sticker"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      title={failed ? `${label} (couldn't be loaded)` : undefined}
      onMouseEnter={() => play === 'hover' && anim.current?.play()}
      onMouseLeave={() => play === 'hover' && anim.current?.goToAndStop(0, true)}
    >
      {failed && <span className="lottie-sticker-name small muted">{label}</span>}
    </div>
  )
}

/** Each sticker's animation, read once per window however often it is drawn. */
const loaded = new Map<string, Promise<unknown>>()

function animationData(accountId: string, stickerId: string): Promise<unknown> {
  let data = loaded.get(stickerId)
  if (!data) {
    data = window.moho
      .rpc<{ path: string }>('discordStickerArt', { accountId, stickerId })
      .then(({ path }) => fetch(resolveMediaUrl(path)))
      .then((r) => {
        if (!r.ok) throw new Error(`sticker ${stickerId}: ${r.status}`)
        return r.json()
      })
    // A failure is not kept: the next time it is drawn may be after the
    // network came back.
    data.catch(() => loaded.delete(stickerId))
    loaded.set(stickerId, data)
  }
  return data
}

/** The sticker id out of a Lottie sticker's CDN link. */
export function lottieStickerId(url: string | undefined): string | null {
  return url?.match(/\/stickers\/(\d+)\.json/)?.[1] ?? null
}

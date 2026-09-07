import { useState } from 'react'
import { resolveMediaUrl, nickColor } from '../lib/util'
import { presenceColor, presenceLabel } from '../lib/presence'

/**
 * Somebody's face, with a fallback for the many people who have no picture.
 *
 * Most protocols have no avatars at all - IRC has never had them, and a
 * Sneedchat or Matrix user may simply not have set one - so the fallback is
 * not an error case but the ordinary one for half the client. It is the same
 * coloured initial the message list already uses in comfy mode, drawn from the
 * same name hash, so the same person is the same colour wherever they appear.
 *
 * A status dot is drawn only when there is a status to report. Somewhere that
 * genuinely does not know shows no dot rather than a confident grey one
 * claiming the person is offline.
 */
export function Avatar({
  name,
  url,
  size = 24,
  status
}: {
  name: string
  url?: string
  size?: number
  status?: string
}): JSX.Element {
  // A picture that will not load falls back to the initial rather than to a
  // broken-image glyph. Not hypothetical: a room directory lists icons hosted
  // on servers that may refuse to hand them over, and a column of broken
  // images is worse than a column of letters.
  const [broken, setBroken] = useState(false)

  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {url && !broken ? (
        <img
          src={resolveMediaUrl(url)}
          alt=""
          style={{ width: size, height: size }}
          // A member list or a long log is hundreds of these, most of them
          // below the fold: fetched and decoded when they are reached rather
          // than all at once on the way past.
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="avatar-fallback"
          style={{ background: nickColor(name), width: size, height: size, fontSize: Math.round(size * 0.45) }}
        >
          {initial(name)}
        </span>
      )}
      {status && (
        <span
          className="presence-dot"
          style={{ background: presenceColor(status) }}
          title={presenceLabel(status)}
        />
      )}
    </span>
  )
}

/**
 * The letter to show for someone with no picture.
 *
 * Skips the sigils protocols put in front of names - an IRC nick prefixed with
 * an operator mark, a Matrix id starting `@` - so the initial is the first
 * letter of who they are rather than punctuation every such user would share.
 */
function initial(name: string): string {
  const letter = [...name].find((c) => /\p{L}|\p{N}/u.test(c))
  return (letter ?? name.slice(0, 1)).toUpperCase()
}

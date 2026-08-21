import type { CSSProperties } from 'react'

interface Props {
  name: string
  size?: number
  color?: string
  fill?: boolean
  className?: string
  style?: CSSProperties
}

/** A Material Symbols glyph, by the same names the QML frontend used. */
export function Icon({ name, size = 20, color, fill, className, style }: Props): JSX.Element {
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
      style={{
        fontSize: size,
        width: size,
        height: size,
        color,
        ...(fill ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : {}),
        ...style
      }}
    >
      {name}
    </span>
  )
}

interface ButtonProps extends Props {
  title?: string
  disabled?: boolean
  onClick?: (e: React.MouseEvent) => void
}

export function IconButton({
  name,
  size = 18,
  color,
  title,
  disabled,
  onClick,
  className,
  style
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `icon-button ${className}` : 'icon-button'}
      title={title}
      aria-label={title ?? name}
      disabled={disabled}
      onClick={onClick}
      style={style}
    >
      <Icon name={name} size={size} color={color} />
    </button>
  )
}

/**
 * A brand SVG recoloured to a theme token via an alpha mask - the same trick
 * the QML frontend used, so a bundled logo lines up exactly with the Material
 * Symbol fallbacks and the text beside it rather than being eyeballed close.
 */
export function MaskIcon({
  src,
  size = 16,
  color = 'var(--surface-variant-text)'
}: {
  src: string
  size?: number
  color?: string
}): JSX.Element {
  // An inlined SVG data URI carries the SVG's own double quotes, which would
  // terminate the url("...") early. Percent-encoding them makes this work for
  // both a bundled file path and an inlined data URI, whatever the bundler
  // chose - a broken mask shows a solid box rather than erroring, so this
  // fails silently and visibly rather than loudly.
  const safeSrc = src.replace(/"/g, '%22')
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        flex: 'none',
        width: size,
        height: size,
        background: color,
        // Quoted: Vite inlines small SVGs as a data: URI, whose commas and
        // semicolons break an unquoted url(). A failed mask doesn't hide the
        // element, it shows the full background box - so this silently
        // rendered as a solid square rather than erroring.
        maskImage: `url("${safeSrc}")`,
        WebkitMaskImage: `url("${safeSrc}")`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center'
      }}
    />
  )
}

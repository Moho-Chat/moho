import { createPortal } from 'react-dom'
import { Icon, IconButton } from './Icon'
import { useEscapeLayer } from '../lib/layers'

/**
 * The frame every dialog shares: a scrim that stops below the title bar (so
 * the window can still be dragged and closed), a panel that grows in, a
 * heading with its title and a way out, and Escape wired to the layer stack.
 * Keeping focus inside it, and giving it back afterwards, is lib/dialogs.ts,
 * which watches for anything marked `role="dialog" aria-modal="true"`.
 *
 * `className` is the panel's own look - its width and padding - since a
 * reason box and a forwarding list are not the same shape.
 */
export function Modal({
  title,
  icon,
  iconColor,
  onClose,
  className,
  header,
  children
}: {
  title: string
  icon?: string
  iconColor?: string
  onClose: () => void
  className?: string
  /**
   * A heading of the dialog's own, in place of the title row: for a dialog whose
   * head is a person's face, or a search box. It brings its own way out; the
   * title is still what a screen reader calls the dialog.
   */
  header?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  useEscapeLayer(onClose)
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div
        className={`dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {header ?? (
          <div className="dialog-head">
            {icon && <Icon name={icon} size={18} color={iconColor} />}
            <span className="dialog-title ellipsis">{title}</span>
            <IconButton name="close" size={16} title="Close" onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}

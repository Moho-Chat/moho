import { Icon } from './Icon'
import { useChat } from '../state/hooks'
import { bufferLink } from '../lib/bufferlink'

/**
 * Said at the top of a conversation that is not receiving: what is wrong, and
 * whether anything is being done about it.
 *
 * Otherwise a room that has lost its connection looks exactly like a quiet
 * one, and the first sign anything is wrong is a message that will not send.
 */
export function ServiceBanner({ bufferId }: { bufferId: string }): JSX.Element | null {
  const buffer = useChat((s) => s.buffers.find((b) => b.id === bufferId))
  const account = useChat((s) => s.accounts.find((a) => a.id === buffer?.accountId))
  const detail = useChat((s) => (buffer ? s.connectionDetail[buffer.accountId] : undefined))
  if (!buffer) return null
  const link = bufferLink(buffer, account, detail)
  if (!link) return null
  return (
    <div className={`service-banner${link.retrying ? '' : ' stopped'}`} role="status">
      {link.retrying ? <span className="spinner" aria-hidden="true" /> : <Icon name="link_off" size={16} />}
      <span className="service-banner-title">Service interruption</span>
      {/* The daemon's own words, which start in lower case when they are a
          library's ("an io error occurred"). */}
      <span className="service-banner-detail">{link.detail.charAt(0).toUpperCase() + link.detail.slice(1)}</span>
    </div>
  )
}

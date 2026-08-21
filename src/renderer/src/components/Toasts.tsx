import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'

export function Toasts(): JSX.Element {
  const store = useStore()
  const toasts = useChat((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <Icon name={toast.kind === 'error' ? 'error' : 'info'} size={16} />
          <span>{toast.text}</span>
          <button type="button" onClick={() => store.dismissToast(toast.id)} title="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

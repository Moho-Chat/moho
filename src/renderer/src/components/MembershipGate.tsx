import { useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/**
 * A server that has let you in but not yet let you speak.
 *
 * Discord calls it membership screening: a server can require agreement to
 * its rules first, and until it is given everything typed into a channel
 * fails - previously with an error about permissions that named no cause, so
 * the conversation simply appeared broken.
 *
 * Sits above the composer rather than replacing it. The box still works for
 * every other server, and hiding it here would be one more thing to explain.
 */
interface VerificationForm {
  description?: string | null
  form_fields?: { field_type?: string; label?: string; description?: string | null }[]
}

export function MembershipGate({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const store = useStore()
  const groups = useChat((s) => s.groups)
  const [rules, setRules] = useState<VerificationForm | null>(null)
  const [busy, setBusy] = useState(false)

  const group = groups.find((g) => g.id === buffer.groupId)
  const guildId = group?.id.split('|guild:')[1]
  if (!group?.pending || !guildId) return null

  const open = (): void => {
    setBusy(true)
    void window.moho
      .rpc<VerificationForm>('getDiscordMemberVerification', {
        accountId: group.accountId,
        guildId
      })
      // An empty form still opens the dialog: the server has a gate even if
      // it wrote nothing to explain it, and agreeing is still what lifts it.
      .then((form) => setRules(form ?? {}))
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const accept = (): void => {
    setBusy(true)
    void window.moho
      .rpc('acceptDiscordMemberVerification', { accountId: group.accountId, guildId })
      .then(() => {
        setRules(null)
        store.toast('info', `You can talk in ${group.name} now.`)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  // The rules as the server wrote them. Discord keeps them in the TERMS
  // field's label, with the description above it as a preamble.
  const terms = rules?.form_fields?.find((f) => f.field_type === 'TERMS') ?? rules?.form_fields?.[0]

  return (
    <>
      <div className="membership-gate">
        <Icon name="lock" size={16} />
        <span className="ellipsis">
          You must complete a few more steps before you can talk in {group.name}.
        </span>
        <button type="button" className="button primary" disabled={busy} onClick={open}>
          Complete
        </button>
      </div>

      {rules && (
        <div className="lightbox-backdrop" onClick={() => setRules(null)}>
          <div
            className="membership-rules"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="membership-rules-head">{group.name}</div>
            {rules.description && <p className="small">{rules.description}</p>}
            {terms?.label && <p className="small">{terms.label}</p>}
            {terms?.description && <p className="small muted">{terms.description}</p>}
            {!rules.description && !terms?.label && (
              <p className="small muted">
                This server asks new members to agree to its rules before talking.
              </p>
            )}
            <div className="membership-rules-actions">
              <button type="button" className="button" onClick={() => setRules(null)} autoFocus>
                Cancel
              </button>
              <button type="button" className="button primary" disabled={busy} onClick={accept}>
                Agree and continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

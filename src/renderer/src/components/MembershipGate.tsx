import { useState } from 'react'
import { Icon } from './Icon'
import { Modal } from './Modal'
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
 *
 * The dialog is the server's own form as Discord's client draws it: the rules
 * as a numbered list with the agreement under them, and any question the
 * server added - a line of text, a paragraph, or a choice of answers.
 */
interface FormField {
  field_type?: string
  label?: string
  description?: string | null
  required?: boolean
  values?: string[] | null
  placeholder?: string | null
}

interface VerificationForm {
  description?: string | null
  form_fields?: FormField[]
  guild?: {
    id?: string
    name?: string
    icon?: string | null
    approximate_member_count?: number
    approximate_presence_count?: number
  }
}

/** The daemon's answer - or, in the screenshot harness only, a fixture standing in for it (see RewardsPanel). */
function ask<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __mohoShots?: unknown; __rpcFixture?: Record<string, (p: Record<string, unknown>) => unknown> }
  const stub = w.__mohoShots ? w.__rpcFixture?.[method] : undefined
  return stub ? Promise.resolve(stub(params) as T) : window.moho.rpc<T>(method, params)
}

/** Whether the person has done what this field needs. */
function answered(field: FormField, answer: unknown): boolean {
  if (!field.required && field.field_type !== 'TERMS') return true
  if (field.field_type === 'TERMS') return answer === true
  if (field.field_type === 'MULTIPLE_CHOICE') return typeof answer === 'number'
  return typeof answer === 'string' && answer.trim().length > 0
}

export function MembershipGate({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const store = useStore()
  const groups = useChat((s) => s.groups)
  const [rules, setRules] = useState<VerificationForm | null>(null)
  const [answers, setAnswers] = useState<unknown[]>([])
  const [busy, setBusy] = useState(false)

  const group = groups.find((g) => g.id === buffer.groupId)
  const guildId = group?.id.split('|guild:')[1]
  if (!group?.pending || !guildId) return null

  const open = (): void => {
    setBusy(true)
    void ask<VerificationForm>('getDiscordMemberVerification', {
        accountId: group.accountId,
        guildId
      })
      // An empty form still opens the dialog: the server has a gate even if
      // it wrote nothing to explain it, and agreeing is still what lifts it.
      .then((form) => {
        setAnswers([])
        setRules(form ?? {})
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const fields = rules?.form_fields ?? []
  const ready = fields.every((f, i) => answered(f, answers[i]))
  const answer = (i: number, value: unknown): void =>
    setAnswers((current) => {
      const next = [...current]
      next[i] = value
      return next
    })

  const accept = (): void => {
    setBusy(true)
    void ask('acceptDiscordMemberVerification', {
      accountId: group.accountId,
      guildId,
      responses: fields.map((_, i) => answers[i] ?? null)
    })
      .then(() => {
        setRules(null)
        store.toast('info', `You can talk in ${group.name} now.`)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const guild = rules?.guild
  const icon = guild?.id && guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` : group.iconUrl
  const name = guild?.name || group.name

  return (
    <>
      <div className="membership-gate">
        <Icon name="lock" size={16} />
        <span className="ellipsis">You must complete a few more steps before you can talk in {group.name}.</span>
        <button type="button" className="button primary" disabled={busy} onClick={open}>
          Complete
        </button>
      </div>

      {rules && (
        <Modal title={name} icon="gavel" className="membership-rules" onClose={() => setRules(null)}>
          <div className="membership-body">
            <div className="membership-card">
              {icon ? <img className="membership-card-icon" src={icon} alt="" /> : <Icon name="groups" size={40} />}
              <div className="membership-card-name">{name}</div>
              {(guild?.approximate_presence_count || guild?.approximate_member_count) && (
                <div className="small muted">
                  {guild.approximate_presence_count ? `${guild.approximate_presence_count.toLocaleString()} online` : ''}
                  {guild.approximate_presence_count && guild.approximate_member_count ? ' · ' : ''}
                  {guild.approximate_member_count ? `${guild.approximate_member_count.toLocaleString()} members` : ''}
                </div>
              )}
            </div>

            <div className="membership-form">
              <h2 className="membership-title">Before you can talk here…</h2>
              <p className="small muted">You&apos;ll need to complete the required steps below.</p>
              {rules.description && <p className="small">{rules.description}</p>}

              {fields.length === 0 && (
                <p className="small muted">This server asks new members to agree to its rules before talking.</p>
              )}

              {fields.map((field, i) => (
                <div key={i} className="membership-field">
                  {field.field_type === 'TERMS' ? (
                    <>
                      <div className="membership-field-label">{field.label || 'Agree to rules'}</div>
                      {field.description && <p className="small muted">{field.description}</p>}
                      {!!field.values?.length && (
                        <ol className="membership-rules-list">
                          {field.values.map((rule, k) => (
                            <li key={k}>{rule}</li>
                          ))}
                        </ol>
                      )}
                      <label className="membership-agree">
                        <input type="checkbox" checked={answers[i] === true} onChange={(e) => answer(i, e.target.checked)} />
                        I have read and agree to the rules
                      </label>
                    </>
                  ) : field.field_type === 'MULTIPLE_CHOICE' ? (
                    <>
                      <div className="membership-field-label">
                        {field.label}
                        {field.required && <span className="muted"> *</span>}
                      </div>
                      {field.description && <p className="small muted">{field.description}</p>}
                      {(field.values ?? []).map((choice, k) => (
                        <label key={k} className="membership-agree">
                          <input type="radio" name={`membership-${i}`} checked={answers[i] === k} onChange={() => answer(i, k)} />
                          {choice}
                        </label>
                      ))}
                    </>
                  ) : (
                    <label className="field">
                      <span className="membership-field-label">
                        {field.label}
                        {field.required && <span className="muted"> *</span>}
                      </span>
                      {field.description && <span className="small muted">{field.description}</span>}
                      {field.field_type === 'PARAGRAPH' ? (
                        <textarea
                          className="text-field"
                          rows={4}
                          placeholder={field.placeholder ?? ''}
                          value={typeof answers[i] === 'string' ? (answers[i] as string) : ''}
                          onChange={(e) => answer(i, e.target.value)}
                        />
                      ) : (
                        <input
                          className="text-field"
                          placeholder={field.placeholder ?? ''}
                          value={typeof answers[i] === 'string' ? (answers[i] as string) : ''}
                          onChange={(e) => answer(i, e.target.value)}
                        />
                      )}
                    </label>
                  )}
                </div>
              ))}

              <div className="membership-rules-actions">
                <button type="button" className="button" onClick={() => setRules(null)}>
                  Cancel
                </button>
                <button type="button" className="button primary" disabled={busy || !ready} onClick={accept}>
                  Submit
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

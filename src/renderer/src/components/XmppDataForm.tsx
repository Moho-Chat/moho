import { useState } from 'react'

/**
 * A form an XMPP server, room or command asks to have filled in (XEP-0004), drawn from the daemon's plain description of it.
 * The answers go back as `{variable: value}`; a field left alone keeps what the form already said, so the daemon only needs
 * what was changed.
 */
export interface XmppFormField {
  var: string
  type: string
  label: string
  desc: string
  required: boolean
  values: string[]
  options: { label: string; value: string }[]
}

export interface XmppForm {
  type: string
  title: string
  instructions: string
  fields: XmppFormField[]
  media: string[]
}

type Answers = Record<string, string | boolean | string[]>

export function XmppDataForm({
  form,
  submitLabel,
  busy,
  onSubmit,
  onCancel
}: {
  form: XmppForm
  submitLabel: string
  busy?: boolean
  onSubmit: (answers: Answers) => void
  onCancel?: () => void
}): JSX.Element {
  const [answers, setAnswers] = useState<Answers>({})
  const set = (name: string, value: string | boolean | string[]): void => setAnswers((a) => ({ ...a, [name]: value }))
  const current = (f: XmppFormField): string | boolean | string[] => {
    if (f.var in answers) return answers[f.var]
    if (f.type === 'boolean') return ['1', 'true'].includes(f.values[0] ?? '')
    if (f.type === 'list-multi' || f.type === 'jid-multi') return f.values
    if (f.type === 'text-multi') return f.values.join('\n')
    return f.values[0] ?? ''
  }
  const missing = form.fields.some((f) => {
    if (!f.required || f.type === 'fixed' || f.type === 'hidden' || f.type === 'boolean') return false
    const v = current(f)
    return Array.isArray(v) ? v.length === 0 : String(v).trim() === ''
  })
  return (
    <div className="add-form">
      {form.instructions && <p className="small muted">{form.instructions}</p>}
      {form.fields.map((f) => {
        if (f.type === 'hidden' || !f.var) return null
        if (f.type === 'fixed') return <p key={f.var + f.values.join()} className="small muted">{f.values.join('\n')}</p>
        const label = f.label || f.var
        const value = current(f)
        return (
          <label key={f.var} className="field">
            {f.type === 'boolean' ? (
              <span className="check-row">
                <input type="checkbox" checked={!!value} disabled={busy} onChange={(e) => set(f.var, e.target.checked)} />
                <span>{label}</span>
              </span>
            ) : (
              <span className="small muted">
                {label}
                {f.required ? ' *' : ''}
              </span>
            )}
            {f.type === 'list-single' && (
              <select className="text-field" value={String(value)} disabled={busy} onChange={(e) => set(f.var, e.target.value)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label || o.value}
                  </option>
                ))}
              </select>
            )}
            {f.type === 'list-multi' && (
              <select
                className="text-field"
                multiple
                value={Array.isArray(value) ? value : []}
                disabled={busy}
                onChange={(e) => set(f.var, [...e.target.selectedOptions].map((o) => o.value))}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label || o.value}
                  </option>
                ))}
              </select>
            )}
            {(f.type === 'text-multi' || f.type === 'jid-multi') && (
              <textarea
                className="text-field"
                rows={3}
                value={Array.isArray(value) ? value.join('\n') : String(value)}
                disabled={busy}
                onChange={(e) => set(f.var, f.type === 'jid-multi' ? e.target.value.split('\n').filter(Boolean) : e.target.value)}
              />
            )}
            {['text-single', 'text-private', 'jid-single', ''].includes(f.type) && (
              <input
                className="text-field"
                type={f.type === 'text-private' ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={String(value)}
                disabled={busy}
                onChange={(e) => set(f.var, e.target.value)}
              />
            )}
            {f.desc && <span className="small muted">{f.desc}</span>}
          </label>
        )
      })}
      <div className="field-row">
        <button type="button" className="button primary" disabled={busy || missing} onClick={() => onSubmit(answers)}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

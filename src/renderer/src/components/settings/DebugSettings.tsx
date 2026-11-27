import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Modal } from '../Modal'
import { useStore } from '../../state/hooks'
import { useEscapeLayer } from '../../lib/layers'
import { humanBytes } from '../../lib/util'
import type { LogUploadInfo } from '../../../../shared/ipc'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

function shortMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatUploadDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (startOfThat === startOfToday) return `Today ${time}`
  if (startOfThat === startOfToday - DAY_MS) return `Yesterday ${time}`
  return shortMonthDay(d)
}

function remainingLabel(expiresAt: string, nowMs: number): string {
  const rem = Math.max(0, new Date(expiresAt).getTime() - nowMs)
  if (rem < MINUTE_MS) return '< 1 m left'
  const days = Math.floor(rem / DAY_MS)
  const hours = Math.floor((rem % DAY_MS) / HOUR_MS)
  if (days > 0) return `${days} d ${hours} h left`
  const mins = Math.floor((rem % HOUR_MS) / MINUTE_MS)
  return hours > 0 ? `${hours} h ${mins} m left` : `${mins} m left`
}

function remainingFraction(createdAt: string, expiresAt: string, nowMs: number): number {
  const start = new Date(createdAt).getTime()
  const end = new Date(expiresAt).getTime()
  const total = end - start
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(1, (end - nowMs) / total))
}

function PrivacyPopover({
  onClose,
  onViewExport
}: {
  onClose: () => void
  onViewExport: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEscapeLayer(onClose)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div ref={ref} className="debug-privacy-popover" role="dialog" aria-label="What an export leaves out">
      <div className="debug-privacy-title">What an export leaves out</div>
      <p className="debug-privacy-body">
        Every line is anonymized before it is saved or uploaded: passwords and tokens are removed,
        usernames, servers, rooms and channels become numbered placeholders, and message text becomes
        its length. An upload is unlisted on paste.gg: anyone with the link can read it until it
        expires 7 days later, or until you delete it here.
      </p>

      <div className="debug-privacy-label">in moho.log</div>
      <pre className="debug-privacy-code selectable">{`[nobilis] discord: send to #general (guild Cozy Corner) by Mohouser failed: 429
[nobilis] matrix @Mohouser:matrix.org login token=syt_TW9o... ok
[nobilis] irc: <bob> hey are you coming tonight?`}</pre>

      <div className="debug-privacy-label">in the export</div>
      <pre className="debug-privacy-code selectable">{`[nobilis] discord: send to channel#2 (guild#1) by user#1 failed: 429
[nobilis] matrix user#1@server#1 login token=[removed] ok
[nobilis] irc: [message, 26 chars]`}</pre>

      <div className="debug-privacy-foot">
        <button type="button" className="debug-privacy-link" onClick={onViewExport}>
          View the whole export first
        </button>
        <button type="button" className="button subtle" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  )
}

/**
 * Debug settings page (#343): export anonymized moho + nobilis logs to
 * Downloads or upload them to paste.gg (anonymous, unlisted, 7-day expiry)
 * with live status checks and early deletion.
 */
export function DebugSettings(): JSX.Element {
  const store = useStore()
  const [uploads, setUploads] = useState<LogUploadInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [preview, setPreview] = useState<{ text: string; sizeBytes: number } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const copyTimer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    void window.moho.logs.list().then((list) => {
      if (alive) setUploads(list)
    })
    // Check live state against paste.gg when the page opens, not on a timer.
    void window.moho.logs.check().then((checked) => {
      if (alive) setUploads(checked)
    })
    return () => {
      alive = false
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  const onSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const res = await window.moho.logs.save()
      if (res.error) {
        store.toast('error', `Could not save logs: ${res.error}`)
      } else if (res.path) {
        const name = res.path.split(/[/\\]/).pop() || res.path
        store.toast('info', `Saved ${name} to Downloads`)
      }
    } finally {
      setSaving(false)
    }
  }

  const onUpload = async (): Promise<void> => {
    setUploading(true)
    try {
      const res = await window.moho.logs.upload()
      if (res.error) {
        store.toast('error', `Upload failed: ${res.error}`)
      } else if (res.uploads) {
        setUploads(res.uploads)
        store.toast('info', 'Uploaded anonymized logs to paste.gg')
      }
    } finally {
      setUploading(false)
    }
  }

  const onCopy = (u: LogUploadInfo): void => {
    void window.moho.copyText(u.url)
    setCopiedId(u.id)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedId(null), 1600)
  }

  const onDelete = async (u: LogUploadInfo): Promise<void> => {
    setDeletingId(u.id)
    try {
      const res = await window.moho.logs.remove(u.id)
      setUploads(res.uploads)
      if (res.error) {
        store.toast('error', `Could not delete paste: ${res.error}`)
      } else {
        store.toast('info', 'Deleted paste from paste.gg')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const onForget = async (u: LogUploadInfo): Promise<void> => {
    const next = await window.moho.logs.forget(u.id)
    setUploads(next)
  }

  const onOpenPreview = async (): Promise<void> => {
    setPrivacyOpen(false)
    setLoadingPreview(true)
    try {
      const res = await window.moho.logs.preview()
      setPreview({ text: res.text, sizeBytes: res.sizeBytes })
    } catch (e) {
      store.toast('error', `Could not prepare log preview: ${(e as Error).message}`)
    } finally {
      setLoadingPreview(false)
    }
  }

  const nowMs = Date.now()

  return (
    <section className="settings-section debug-section">
      <div className="settings-section-title section-label">Logs</div>
      <div className="settings-section-desc small muted">
        What moho and nobilis wrote this session and the one before, anonymized: no passwords,
        tokens, usernames or message text. The moho and nobilis versions and your OS head the file.
      </div>

      <div className="debug-actions-wrap">
        <div className="debug-actions">
          <div className="debug-actions-main">
            <button
              type="button"
              className="button subtle"
              disabled={saving || uploading}
              onClick={() => void onSave()}
            >
              <Icon name="download" size={16} />
              {saving ? 'Saving\u2026' : 'Save to Downloads'}
            </button>
            <button
              type="button"
              className="button"
              disabled={saving || uploading}
              onClick={() => void onUpload()}
            >
              <Icon name="upload" size={16} />
              {uploading ? 'Uploading\u2026' : 'Upload to paste.gg'}
            </button>
          </div>
          <button
            type="button"
            className={`debug-privacy-btn${privacyOpen ? ' active' : ''}`}
            disabled={loadingPreview}
            onClick={() => setPrivacyOpen((v) => !v)}
          >
            <Icon name="gpp_maybe" size={16} />
            Privacy concerns?
          </button>
        </div>

        {privacyOpen && (
          <PrivacyPopover
            onClose={() => setPrivacyOpen(false)}
            onViewExport={() => void onOpenPreview()}
          />
        )}
      </div>

      {uploads.length > 0 && (
        <div className="debug-upload-grid">
          {uploads.map((u) => {
            const active = u.status === 'active'
            const frac = active ? remainingFraction(u.createdAt, u.expiresAt, nowMs) : 0
            const displayUrl = u.url.replace(/^https?:\/\//, '')
            const goneDate = shortMonthDay(new Date(u.goneAt || u.expiresAt))
            const goneLabel =
              u.goneReason === 'deleted'
                ? `Deleted ${goneDate}`
                : `Gone from paste.gg ${goneDate}`

            return (
              <div key={u.id} className={`debug-upload-card${active ? '' : ' expired'}`}>
                <div className="debug-card-head">
                  <span className="debug-card-date">{formatUploadDate(u.createdAt)}</span>
                  <span className={`debug-pill ${active ? 'active' : 'expired'}`}>
                    {active ? 'Active' : 'Expired'}
                  </span>
                </div>

                <div className="debug-card-meta small muted">
                  {humanBytes(u.sizeBytes)} {'\u00b7'}{' '}
                  {u.linesOmitted > 0
                    ? `oldest ${u.linesOmitted.toLocaleString()} lines left out`
                    : 'whole log'}
                </div>

                <div className="debug-card-link-row">
                  {active ? (
                    <button
                      type="button"
                      className="debug-card-url ellipsis"
                      title={u.url}
                      onClick={() => void window.moho.openExternal(u.url)}
                    >
                      {displayUrl}
                    </button>
                  ) : (
                    <span className="debug-card-url expired ellipsis" title={u.url}>
                      {displayUrl}
                    </span>
                  )}
                  {active && (
                    <button
                      type="button"
                      className="debug-card-copy"
                      onClick={() => onCopy(u)}
                    >
                      {copiedId === u.id ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>

                <div className="debug-card-bar">
                  {active && (
                    <div
                      className={`debug-card-bar-fill${frac < 0.5 ? ' warn' : ''}`}
                      style={{ width: `${Math.round(frac * 100)}%` }}
                    />
                  )}
                </div>

                <div className="debug-card-foot small">
                  <span className="muted">
                    {active ? remainingLabel(u.expiresAt, nowMs) : goneLabel}
                  </span>
                  {active ? (
                    <button
                      type="button"
                      className="debug-card-delete"
                      disabled={deletingId === u.id}
                      onClick={() => void onDelete(u)}
                    >
                      {deletingId === u.id ? 'Deleting\u2026' : 'Delete now'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="debug-card-forget"
                      onClick={() => void onForget(u)}
                    >
                      Forget
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {preview && (
        <Modal
          title={`Anonymized log export (${humanBytes(preview.sizeBytes)})`}
          icon="description"
          className="debug-preview-modal"
          onClose={() => setPreview(null)}
        >
          <pre className="debug-preview-body selectable">{preview.text}</pre>
          <div className="debug-preview-foot">
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                void window.moho.copyText(preview.text)
                store.toast('info', 'Copied anonymized logs')
              }}
            >
              <Icon name="content_copy" size={15} />
              Copy all
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setPreview(null)
                void onSave()
              }}
            >
              <Icon name="download" size={15} />
              Save to Downloads
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

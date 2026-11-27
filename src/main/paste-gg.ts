import fs from 'node:fs'
import path from 'node:path'

export const PASTE_GG_API = 'https://api.paste.gg/v1'
export const PASTE_GG_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface PasteGgResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type PasteGgFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<PasteGgResponse>

/** Full record persisted in main (includes the deletion key). */
export interface LogUploadRecord {
  id: string
  url: string
  deletionKey: string
  createdAt: string
  expiresAt: string
  sizeBytes: number
  linesOmitted: number
  status: 'active' | 'expired'
  goneAt?: string
  goneReason?: 'deleted' | 'expired'
}

/** Renderer-facing projection: never exposes `deletionKey`. */
export type LogUploadInfo = Omit<LogUploadRecord, 'deletionKey'>

export function toPublicUpload(r: LogUploadRecord): LogUploadInfo {
  const { deletionKey: _key, ...rest } = r
  return rest
}

/**
 * Creates an anonymous unlisted paste on paste.gg expiring in 7 days.
 * Returns the paste id, public URL, expiry timestamp, and deletion key.
 */
export async function uploadToPasteGg(
  content: string,
  fetchFn: PasteGgFetch,
  now = new Date()
): Promise<{ id: string; url: string; deletionKey: string; createdAt: string; expiresAt: string }> {
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + PASTE_GG_TTL_MS).toISOString()
  const stamp = createdAt.slice(0, 16).replace('T', ' ')

  const res = await fetchFn(`${PASTE_GG_API}/pastes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `moho logs (${stamp} UTC)`,
      visibility: 'unlisted',
      expires: expiresAt,
      files: [
        {
          name: 'moho-logs.txt',
          content: {
            format: 'text',
            value: content
          }
        }
      ]
    })
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(extractPasteGgError(raw) || `paste.gg returned HTTP ${res.status}`)
  }

  let parsed: {
    status?: string
    result?: { id?: string; deletion_key?: string; expires?: string }
    message?: string
  }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('paste.gg returned an unreadable response')
  }

  const id = parsed.result?.id
  const deletionKey = parsed.result?.deletion_key
  if (!id || !deletionKey) {
    throw new Error(parsed.message || 'paste.gg response did not include a paste id and deletion key')
  }

  return {
    id,
    url: `https://paste.gg/p/anonymous/${id}`,
    deletionKey,
    createdAt,
    expiresAt: parsed.result?.expires || expiresAt
  }
}

/**
 * Checks whether a paste is still live on paste.gg.
 * Returns `'expired'` on 404 (`missing_paste`), `'active'` on 200, and
 * `'unknown'` on transient/network errors so offline opens do not falsely
 * mark live pastes expired.
 */
export async function checkPasteGg(
  id: string,
  fetchFn: PasteGgFetch
): Promise<'active' | 'expired' | 'unknown'> {
  try {
    const res = await fetchFn(`${PASTE_GG_API}/pastes/${encodeURIComponent(id)}`, {
      method: 'GET'
    })
    if (res.status === 200) return 'active'
    if (res.status === 404) return 'expired'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Deletes an anonymous paste early using its stored `deletion_key`.
 * 204 (deleted) and 404 (already gone) both count as gone.
 */
export async function deleteFromPasteGg(
  id: string,
  deletionKey: string,
  fetchFn: PasteGgFetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchFn(`${PASTE_GG_API}/pastes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Key ${deletionKey}` }
    })
    if (res.status === 204 || res.status === 404) return { ok: true }
    const raw = await res.text().catch(() => '')
    return { ok: false, error: extractPasteGgError(raw) || `paste.gg returned HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function extractPasteGgError(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string }
    return parsed.message || parsed.error || null
  } catch {
    return null
  }
}

/**
 * Durable store for paste.gg uploads, kept in `userData/log-uploads.json`
 * rather than `prefs.json` so deletion keys never travel to the renderer.
 */
export class LogUploadStore {
  private records: LogUploadRecord[] = []

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (Array.isArray(parsed)) {
        this.records = parsed.filter(
          (r): r is LogUploadRecord =>
            r && typeof r === 'object' && typeof r.id === 'string' && typeof r.url === 'string'
        )
      }
    } catch {
      this.records = []
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.records, null, 2))
  }

  all(): LogUploadRecord[] {
    return [...this.records]
  }

  publicList(): LogUploadInfo[] {
    return this.records.map(toPublicUpload)
  }

  get(id: string): LogUploadRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  add(record: LogUploadRecord): LogUploadInfo[] {
    this.records = [record, ...this.records.filter((r) => r.id !== record.id)]
    this.save()
    return this.publicList()
  }

  markExpired(id: string, reason: 'deleted' | 'expired', goneAt = new Date().toISOString()): boolean {
    const target = this.records.find((r) => r.id === id)
    if (!target) return false
    if (target.status === 'expired' && target.goneReason === reason) return false
    target.status = 'expired'
    target.goneReason = reason
    target.goneAt = goneAt
    this.save()
    return true
  }

  forget(id: string): LogUploadInfo[] {
    const before = this.records.length
    this.records = this.records.filter((r) => r.id !== id)
    if (this.records.length !== before) this.save()
    return this.publicList()
  }
}

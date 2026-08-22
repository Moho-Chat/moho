import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * Saving media to disk.
 *
 * Kept apart from the IPC wiring because the interesting parts - not
 * overwriting an existing file, and not letting a name that arrived in a chat
 * message decide where the file lands - are worth testing on their own.
 */

/**
 * A path that doesn't exist yet, suffixing "(2)", "(3)"... before the
 * extension. Saving the same picture twice should leave two files, the way a
 * browser's download does, rather than silently replacing the first.
 */
export function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const stem = path.basename(target, ext)
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${stem} (${n})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`)
}

/**
 * A filename safe to join onto the download directory.
 *
 * The name comes from whoever sent the message, so it is hostile input:
 * basename strips any directory part (including "../" traversal), and the
 * remaining separators and Windows-reserved characters are replaced so the
 * result can only ever name a file directly inside the chosen folder.
 */
export function safeName(filename: string | undefined, source: string): string {
  const raw = filename || source.split('?')[0] || 'download'
  const base = path.basename(raw)
  const cleaned = base.replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return cleaned || 'download'
}

/** A local path if this source is already on disk, else null. */
export function localPath(source: string): string | null {
  if (source.startsWith('file://')) return decodeURI(source.slice('file://'.length))
  if (source.startsWith('/')) return source
  return null
}

export interface SaveResult {
  path?: string
  error?: string
}

/**
 * Saves one piece of media into `dir`.
 *
 * Handles both shapes moho deals in: a remote URL (Discord's CDN) and a local
 * cache file nobilis already fetched (Matrix, Sneedchat over Tor), where
 * saving is a copy rather than a request - a Sneedchat attachment could not be
 * re-fetched here in any case, since only the daemon holds the Tor circuit.
 */
export async function saveMedia(
  source: string,
  filename: string | undefined,
  dir: string,
  fetchRemote: (url: string) => Promise<{ ok: boolean; status: number; bytes: () => Promise<Uint8Array> }>
): Promise<SaveResult> {
  try {
    await fsp.mkdir(dir, { recursive: true })
    const target = uniquePath(path.join(dir, safeName(filename, source)))
    const local = localPath(source)

    if (local) {
      await fsp.copyFile(local, target)
    } else {
      if (!/^https?:\/\//i.test(source)) return { error: 'unsupported link' }
      const res = await fetchRemote(source)
      if (!res.ok) return { error: `server returned ${res.status}` }
      await fsp.writeFile(target, await res.bytes())
    }
    return { path: target }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

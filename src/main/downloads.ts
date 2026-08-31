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
 * Windows keeps these reserved whatever extension follows them, and opening
 * one talks to a device rather than to a file.
 */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/**
 * A filename safe to join onto the download directory.
 *
 * The name comes from whoever sent the message, so it is hostile input:
 * basename strips any directory part (including "../" traversal), and the
 * remaining separators and Windows-reserved characters are replaced so the
 * result can only ever name a file directly inside the chosen folder.
 *
 * The Windows-specific rules are applied on every platform, not only there.
 * A name that is harmless on Linux can be a device on Windows, and a trailing
 * dot or space is silently dropped there - so "evil.exe." and "evil.exe" are
 * one file on one platform and two on the other. Deciding that per-platform
 * would mean the same message produced a different file depending on where it
 * was read, which is the kind of difference nobody tests.
 *
 * Kept in step with `safe_file_name` in nobilis's backend/irc_dcc.rs, which
 * does this same job for files arriving over IRC.
 */
export function safeName(filename: string | undefined, source: string): string {
  const raw = filename || source.split('?')[0] || 'download'
  // Both separators regardless of platform: the name came off the network,
  // not off this filesystem. path.basename only knows about this one.
  const base = raw.split(/[/\\]/).pop() ?? ''
  // Drops a drive letter, and an alternate data stream with it.
  const withoutDrive = base.split(':').pop() ?? ''
  const cleaned = withoutDrive
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  if (!cleaned) return 'download'
  return RESERVED.test(cleaned.split('.')[0]) ? `_${cleaned}` : cleaned
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

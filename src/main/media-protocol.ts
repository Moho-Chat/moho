import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { log } from './log'

/**
 * nobilis hands back local `file://` paths for media it has already fetched on
 * the client's behalf - Tor-routed Sneedchat avatars and attachments, Matrix
 * media, a sign-in QR code. The renderer has no route to any of those origins
 * itself, which is why they arrive as local files in the first place.
 *
 * Serving them through a dedicated scheme rather than turning off webSecurity
 * keeps the renderer unable to read arbitrary files - and this is the layer
 * that holds when every other one has been got past (#247). It serves:
 *
 * - files directly inside the daemon's named media caches, and only if their
 *   first bytes say they are a picture, a video or audio (a sticker's JSON in
 *   the sticker cache alone) - never its config directory, never the system
 *   temp directory, never anything nested or linked out;
 * - the app's own files: its bundled resources, rail icons somebody chose;
 * - single files the person picked or pasted this session.
 *
 * So a message that names a path - `moho-media://file/?p=/etc/passwd`, or the
 * account file - gets nothing, whatever the window was persuaded to ask for.
 */

export const SCHEME = 'moho-media'

/** Extra roots registered at startup - the app's own bundled resources dir. */
const extraRoots: string[] = []

/** Paths already reported as refused, so each is logged once. */
const refused = new Set<string>()

export function allowRoot(dir: string): void {
  extraRoots.push(path.resolve(dir) + path.sep)
}

/**
 * Single files the person themself chose in a native picker this session.
 *
 * A file being staged for sending lives wherever they keep their pictures,
 * which is nowhere near the daemon's cache - so the thumbnail in the composer
 * was refused and every picked file showed as broken, while a pasted one
 * worked because the clipboard writes to a temp dir that is already allowed.
 *
 * Individual files rather than their directory: picking one image out of a
 * folder is not consent to read the rest of it, and it is certainly not
 * consent to read the parent of whatever they picked. Nothing is added here
 * that did not come back from a picker the person drove themself, which is
 * why this cannot be reached by a hostile message body.
 */
const pickedFiles = new Set<string>()

export function allowPickedFile(filePath: string): void {
  pickedFiles.add(comparable(path.resolve(filePath)))
}

/**
 * Where nobilis keeps its cache and config, on whichever system this is.
 *
 * Has to agree with Rust's `dirs` crate, which is what the daemon uses - not
 * with Electron's own `app.getPath`, which answers for *this* application and
 * would point somewhere nobilis never writes. The two disagree per platform,
 * so guessing one convention everywhere is how the allowlist below ends up
 * refusing every image the daemon fetched: XDG paths on Windows resolve to a
 * `.cache` directory under the profile that nothing ever writes to, and the
 * check would fail closed and silently.
 */
function daemonDirs(): { cache: string; config: string }[] {
  const home = os.homedir()
  // The legacy shape, which the daemon still prefers wherever it already
  // exists so that nobody's accounts move out from under them. Listed on
  // every platform rather than only on Linux, because a Windows install that
  // ran an older nobilis really does have one.
  const legacy = {
    cache: process.env.XDG_CACHE_HOME || path.join(home, '.cache'),
    config: process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  }
  if (process.platform === 'win32') {
    // dirs::cache_dir is LOCALAPPDATA and dirs::config_dir is APPDATA -
    // two different directories, unlike the single ~/.config habit.
    return [
      {
        cache: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        config: process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      },
      { cache: legacy.cache, config: path.join(home, '.config') }
    ]
  }
  if (process.platform === 'darwin') {
    return [
      {
        cache: path.join(home, 'Library', 'Caches'),
        config: path.join(home, 'Library', 'Application Support')
      },
      legacy
    ]
  }
  return [legacy]
}

/**
 * The daemon's caches the window may draw from: the list in nobilis's
 * media_cache.rs, and `transient`, where it writes what is drawn once and
 * thrown away - a sign-in QR code, a voice message before it is sent.
 *
 * Named folders rather than the daemon's whole cache, and nothing from its
 * config directory: that is where `accounts.toml`, the scrollback and the
 * Matrix crypto store live, and no picture is ever drawn from there. And not
 * the system temp directory, which used to be served whole - every file any
 * program put there.
 */
const DAEMON_MEDIA_DIRS = [
  'matrix-media',
  'sneedchat-attachments',
  'sneedchat-avatars',
  'discord-thumbnails',
  'discord-icons',
  'kick-emotes',
  'discord-stickers',
  'discord-sounds',
  'transient'
]

/**
 * The same caches under the daemon's pre-rename directory. Its migration only
 * moves these when the destination does not already exist, so a client that
 * ran under both names has stored messages still naming the old one.
 */
const LEGACY_MEDIA_DIRS = ['matrix-media', 'sneedchat-attachments', 'sneedchat-avatars']

/** Where a Lottie sticker's animation is - the one place JSON is served. */
const STICKER_DIR = 'discord-stickers'

function allowedRoots(): string[] {
  return daemonDirs()
    .flatMap(({ cache }) => [
      ...DAEMON_MEDIA_DIRS.map((dir) => path.join(cache, 'nobilis', dir)),
      ...LEGACY_MEDIA_DIRS.map((dir) => path.join(cache, 'moho', dir))
    ])
    .map((p) => path.resolve(p) + path.sep)
}

/**
 * Whether these bytes are something the window draws or plays: a picture, a
 * video, or audio. Read from the file rather than taken from its name, because
 * a name says nothing about what is in a file - and the point is that nothing
 * else is served, whatever it is called.
 *
 * Exported for tests.
 */
export function isMediaBytes(head: Uint8Array, allowJson = false): boolean {
  const at = (i: number, ...bytes: number[]): boolean => bytes.every((b, k) => head[i + k] === b)
  const ascii = (i: number, text: string): boolean => at(i, ...[...text].map((c) => c.charCodeAt(0)))
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return true // PNG
  if (at(0, 0xff, 0xd8, 0xff)) return true // JPEG
  if (ascii(0, 'GIF8')) return true
  if (ascii(0, 'RIFF') && (ascii(8, 'WEBP') || ascii(8, 'WAVE') || ascii(8, 'AVI '))) return true
  if (ascii(0, 'BM')) return true
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return true // ICO
  if (ascii(4, 'ftyp')) return true // MP4, MOV, AVIF, HEIC, M4A
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return true // WebM, Matroska
  if (ascii(0, 'OggS')) return true // Ogg: Opus, Vorbis
  if (ascii(0, 'fLaC')) return true
  if (ascii(0, 'ID3')) return true // MP3 with a tag
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true // MP3 frame
  if (allowJson) {
    const first = [...head].find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09)
    if (first === 0x7b) return true // {
  }
  return false
}

/** The first bytes of a file, or nothing if it cannot be read. */
function headOf(filePath: string): Uint8Array | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const head = new Uint8Array(32)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    return head.subarray(0, n)
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/**
 * Compares two paths the way the filesystem underneath would.
 *
 * Windows and macOS match filenames case-insensitively, so `C:\Users\...` and
 * `c:\users\...` name the same file while `startsWith` calls them different.
 * Getting that wrong here fails closed - the image is refused rather than
 * leaked - but a media allowlist that silently blanks half the avatars is
 * still broken, and the fix belongs with the comparison rather than at each
 * call site.
 */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'
function comparable(p: string): string {
  return CASE_INSENSITIVE_FS ? p.toLowerCase() : p
}
function underRoot(candidate: string, root: string): boolean {
  return comparable(candidate).startsWith(comparable(root))
}

/** Whether a path names somewhere inside the roots, without touching the disk. */
function insideRoots(target: string): boolean {
  const resolved = path.resolve(target) + path.sep
  return allowedRoots().some((root) => underRoot(resolved, root))
}

/** Exported for tests: this predicate is the whole security boundary. */
export function isAllowed(target: string): boolean {
  const resolved = path.resolve(target)
  // Reject symlinks that escape the allowed roots - resolve the real path
  // first, so a link planted inside the cache dir can't point outward.
  let real = resolved
  try {
    real = fs.realpathSync(resolved)
  } catch {
    return false
  }
  if (pickedFiles.has(comparable(resolved)) || pickedFiles.has(comparable(real))) return true
  // The app's own files - its bundled resources, a rail icon somebody chose -
  // are whatever they are; they never came from anybody else.
  const own = (p: string): boolean => extraRoots.some((root) => underRoot(p + path.sep, root))
  if (own(resolved) && own(real)) return true

  const roots = allowedRoots()
  const inside = (p: string): boolean => roots.some((root) => underRoot(p + path.sep, root))
  // A link planted inside that points out is judged by where it points.
  if (!inside(resolved) || !inside(real)) return false
  // Directly inside a cache folder, never deeper: nothing the daemon writes
  // is nested, and a subfolder is not something it made.
  if (!roots.some((root) => comparable(path.dirname(real) + path.sep) === comparable(root))) return false
  const head = headOf(real)
  if (!head) return false
  return isMediaBytes(head, path.basename(path.dirname(real)) === STICKER_DIR)
}

/** Must run before app.whenReady(). */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      // corsEnabled, and the header below, so the page can read a file and
      // not only draw one: the page is file://, which makes every request to
      // this scheme cross-origin, and an <img> needs no permission where a
      // fetch() does. A Lottie sticker is JSON read by script.
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

/** Must run after app.whenReady(). */
export function installMediaHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    // The absolute path arrives as ?p=..., not as the URL path - see
    // resolveMediaUrl for why the path component can't be trusted here.
    const filePath = new URL(request.url).searchParams.get('p')
    if (!filePath) return new Response('bad request', { status: 400 })
    // Missing is not refused. A cache sweep deletes files the window may still
    // name, and logging that as a request outside the roots made an ordinary
    // eviction read like an attack on the boundary. Only inside the roots,
    // so this says nothing about whether a file exists anywhere else.
    if (insideRoots(filePath) && !fs.existsSync(filePath)) return new Response('not found', { status: 404 })
    if (!isAllowed(filePath)) {
      // Once per path: a refused avatar is re-requested for every message its
      // sender ever posted, and logging each one buries anything else.
      if (!refused.has(filePath)) {
        refused.add(filePath)
        log.warn('[media] refused request:', filePath)
      }
      return new Response('forbidden', { status: 403 })
    }
    const response = await net.fetch(pathToFileURL(filePath).toString())
    // Readable by the page as well as drawable by it. Nothing is opened up by
    // this: the only pages are this app's own, and what is served is already
    // limited to the roots above.
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { log } from './log'

/**
 * nobilis hands back local `file://` paths for media it has already fetched on
 * the client's behalf - Tor-routed Sneedchat avatars and attachments, Matrix
 * media, the Discord login QR (see each nobilis backend's own cache dir).
 * The renderer has no route to any of those origins itself, which is why they
 * arrive as local files in the first place.
 *
 * Serving them through a dedicated scheme rather than turning off webSecurity
 * keeps the renderer unable to read arbitrary files: this handler resolves
 * only inside the known cache roots and refuses everything else, so a hostile
 * message body cannot smuggle `moho-media:///etc/passwd` past it.
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
function daemonDirs(): { cache: string; config: string } {
  const home = os.homedir()
  if (process.platform === 'win32') {
    // dirs::cache_dir is LOCALAPPDATA and dirs::config_dir is APPDATA -
    // different directories on Windows, unlike the single ~/.config habit.
    return {
      cache: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      config: process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    }
  }
  if (process.platform === 'darwin') {
    return {
      cache: path.join(home, 'Library', 'Caches'),
      config: path.join(home, 'Library', 'Application Support')
    }
  }
  return {
    cache: process.env.XDG_CACHE_HOME || path.join(home, '.cache'),
    config: process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  }
}

/**
 * These are the *daemon's* directories, not this app's: every local path that
 * arrives on the wire was written by nobilis (Tor-fetched Sneedchat media,
 * Matrix media, the Discord login QR), so nobilis is what the roots have to
 * track. They moved with the rename - pointing them at moho's own dirs
 * silently refuses every image the daemon fetches.
 */
function allowedRoots(): string[] {
  const { cache, config } = daemonDirs()
  return [
    path.join(cache, 'nobilis'),
    path.join(config, 'nobilis'),
    // The daemon's pre-rename directories. Its migration only moves these
    // when the destination does not already exist, so a client that ran under
    // both names ends up with the two side by side and years of stored
    // messages still naming the old one. Those files are the user's own cache
    // either way; refusing them only blanks the avatars on old scrollback.
    path.join(cache, 'moho'),
    path.join(config, 'moho'),
    os.tmpdir()
  ]
    .map((p) => path.resolve(p) + path.sep)
    .concat(extraRoots)
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
function underRoot(candidate: string, root: string): boolean {
  const c = CASE_INSENSITIVE_FS ? candidate.toLowerCase() : candidate
  const r = CASE_INSENSITIVE_FS ? root.toLowerCase() : root
  return c.startsWith(r)
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
  if (real !== resolved && !allowedRoots().some((root) => underRoot(real + path.sep, root))) {
    return false
  }
  return allowedRoots().some((root) => underRoot(resolved + path.sep, root))
}

/** Must run before app.whenReady(). */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/** Must run after app.whenReady(). */
export function installMediaHandler(): void {
  protocol.handle(SCHEME, (request) => {
    // The absolute path arrives as ?p=..., not as the URL path - see
    // resolveMediaUrl for why the path component can't be trusted here.
    const filePath = new URL(request.url).searchParams.get('p')
    if (!filePath) return new Response('bad request', { status: 400 })
    if (!isAllowed(filePath)) {
      // Once per path: a refused avatar is re-requested for every message its
      // sender ever posted, and logging each one buries anything else.
      if (!refused.has(filePath)) {
        refused.add(filePath)
        log.warn('[media] refused out-of-root request:', filePath)
      }
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

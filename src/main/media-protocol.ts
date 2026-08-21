import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

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

export function allowRoot(dir: string): void {
  extraRoots.push(path.resolve(dir) + path.sep)
}

function allowedRoots(): string[] {
  const home = os.homedir()
  const cacheRoot = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'moho')
  const configRoot = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'moho')
  return [cacheRoot, configRoot, os.tmpdir()]
    .map((p) => path.resolve(p) + path.sep)
    .concat(extraRoots)
}

function isAllowed(target: string): boolean {
  const resolved = path.resolve(target)
  // Reject symlinks that escape the allowed roots - resolve the real path
  // first, so a link planted inside the cache dir can't point outward.
  let real = resolved
  try {
    real = fs.realpathSync(resolved)
  } catch {
    return false
  }
  if (real !== resolved && !allowedRoots().some((root) => (real + path.sep).startsWith(root))) {
    return false
  }
  return allowedRoots().some((root) => (resolved + path.sep).startsWith(root))
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
      console.warn('[media] refused out-of-root request:', filePath)
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

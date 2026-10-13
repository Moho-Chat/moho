/**
 * What Steam takes as a file in a chat: the types and the size its own client
 * checks before it will start an upload. The daemon checks the same before it
 * sends; this is here so a file that will be refused says so at once, beside
 * the box, instead of after the message has been written and sent.
 */
export const STEAM_FILE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'mp4', 'webm', 'mpg', 'mpeg', 'ogv']

/** Thirty megabytes, the client's own limit. */
export const STEAM_MAX_BYTES = 30 * 1024 * 1024

/** Why Steam will not take this file, or null if it will. */
export function steamFileRefusal(name: string, size?: number): string | null {
  const dot = name.lastIndexOf('.')
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  if (!STEAM_FILE_TYPES.includes(extension)) {
    return `Steam does not take ${extension ? `.${extension}` : 'that kind of'} files in chat - it takes ${STEAM_FILE_TYPES.join(', ')}`
  }
  if (size === 0) return `${name} is empty`
  if (size !== undefined && size > STEAM_MAX_BYTES) return `${name} is over the ${STEAM_MAX_BYTES / 1024 / 1024} MB Steam allows in chat`
  return null
}

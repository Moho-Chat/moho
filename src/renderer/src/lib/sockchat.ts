/**
 * The Sneedchat rooms an account can be connected to.
 *
 * No server-side "list every room" endpoint exists, so this is the fixed
 * catalogue the account was originally configured against. Adding a room the
 * site actually has just means it can be toggled on too.
 *
 * Shared rather than owned by whichever pane happens to draw it: the rooms are
 * a property of an account, and two places disagreeing about which rooms exist
 * would be worse than either of them being incomplete.
 */
export const KNOWN_SOCKCHAT_ROOMS: { id: number; name: string }[] = [
  { id: 1, name: 'general' },
  { id: 8, name: 'gunt' },
  { id: 15, name: 'keno-kasino' },
  { id: 16, name: 'fishtank' },
  { id: 18, name: 'beauty-parlor' },
  { id: 19, name: 'sports' }
]

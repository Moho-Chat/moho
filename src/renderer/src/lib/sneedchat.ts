/**
 * The Sneedchat rooms this client knows about without asking.
 *
 * No longer the catalogue: the daemon reads the real one off the site's own
 * chat page (see listSneedChatRooms), which is how #lolcows was reachable to
 * everybody using the site and to nobody using this. This is what shows while
 * that is being fetched, and what remains if it cannot be - the site sits
 * behind a proof-of-work gate over Tor, and rooms somebody can still tick beat
 * an empty list.
 *
 * Shared rather than owned by whichever pane happens to draw it: the rooms are
 * a property of an account, and two places disagreeing about which rooms exist
 * would be worse than either of them being incomplete.
 */
export const KNOWN_SNEEDCHAT_ROOMS: { id: number; name: string }[] = [
  { id: 1, name: 'general' },
  { id: 8, name: 'gunt' },
  { id: 15, name: 'keno-kasino' },
  { id: 16, name: 'fishtank' },
  { id: 18, name: 'beauty-parlor' },
  { id: 19, name: 'sports' },
  { id: 20, name: 'lolcows' }
]

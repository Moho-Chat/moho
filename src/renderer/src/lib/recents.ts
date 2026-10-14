/**
 * Which of the emoji somebody picked lately may be offered again in the conversation that is open.
 *
 * A recent pick is stored as the text that was sent. An emoji that belongs to somewhere else - another Discord
 * server's, another Kick channel's, a Twitch emote that was unlocked for a day and has lapsed, one that needs a
 * subscription this account lacks - is something this conversation cannot take, and offering it is offering
 * something that will not work. So it is left out, on every service. The stored list itself is not touched, so a
 * pick comes back where it works again.
 */

/** Whether a pick is an ordinary Unicode emoji and not a stand-in (`<:name:id>`, `[twitch:...]`, `:shortcode:`). */
export function isPlainEmoji(pick: string): boolean {
  return !/[A-Za-z0-9_:<>[\]]/.test(pick)
}

/**
 * The recent picks that can be sent here. `onOffer` is the text of everything this conversation can send; until the
 * daemon has said what that is (`loaded`), only the ordinary emoji are shown, and where the service has a fixed set
 * of its own (Steam's) ordinary emoji are not accepted at all.
 */
export function recentsHere(recent: string[], onOffer: ReadonlySet<string>, loaded: boolean, fixedSet: boolean): string[] {
  return recent.filter((r) => (isPlainEmoji(r) ? !fixedSet : loaded && onOffer.has(r)))
}

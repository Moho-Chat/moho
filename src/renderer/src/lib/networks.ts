/**
 * The IRC networks somebody is actually likely to be joining.
 *
 * Typing a hostname and a port correctly is the one step of adding an IRC
 * account where a small mistake looks like the server being down, so the
 * common ones are offered ready-made. Deliberately short: this is a shortcut
 * for the networks people use, not a directory - "Other" is always there and
 * is what every network not on the list uses.
 *
 * Colours are the network's own where it has a recognisable one, and are used
 * to tell one server tile from another in the rail. Marks are initials rather
 * than logos: those belong to the networks that own them, and a wrong-looking
 * copy of somebody's logo is worse than two clean letters. Anybody who wants
 * a network's real logo can import one - see the icon picker in Accounts,
 * which outranks everything here.
 *
 * Each is deep enough to carry white initials at 4.6:1 or better, because
 * the tile is filled with it. Several were a shade or two brighter and were
 * darkened rather than dropped: they were being used as coloured text on the
 * tile instead, where Libera managed 1.7:1 against an active tile and was
 * effectively invisible. Hue and saturation are untouched, so each still
 * reads as the colour that network is known by.
 */
export interface IrcNetwork {
  id: string
  name: string
  host: string
  port: number
  tls: boolean
  /** Two characters at most, for the rail tile. */
  mark: string
  colour: string
}

export const IRC_NETWORKS: IrcNetwork[] = [
  { id: 'libera', name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, tls: true, mark: 'Li', colour: '#7f4bd8' },
  { id: 'oftc', name: 'OFTC', host: 'irc.oftc.net', port: 6697, tls: true, mark: 'OF', colour: '#2d7ab7' },
  { id: 'rizon', name: 'Rizon', host: 'irc.rizon.net', port: 6697, tls: true, mark: 'Ri', colour: '#c84b4b' },
  { id: 'quakenet', name: 'QuakeNet', host: 'irc.quakenet.org', port: 6667, tls: false, mark: 'QN', colour: '#9f6a20' },
  { id: 'efnet', name: 'EFnet', host: 'irc.efnet.org', port: 6697, tls: true, mark: 'EF', colour: '#448060' },
  { id: 'undernet', name: 'Undernet', host: 'irc.undernet.org', port: 6697, tls: true, mark: 'UN', colour: '#3f6fa8' },
  { id: 'snoonet', name: 'Snoonet', host: 'irc.snoonet.org', port: 6697, tls: true, mark: 'Sn', colour: '#c54f1f' },
  { id: 'hackint', name: 'hackint', host: 'irc.hackint.org', port: 6697, tls: true, mark: 'hi', colour: '#4b7d7e' }
]

/**
 * The network a hostname belongs to, or null.
 *
 * Matched on the registrable part of the host rather than the whole thing,
 * since a network answers on many names - irc.libera.chat, but also
 * ipv6.libera.chat and any number of round-robin aliases.
 */
export function ircNetworkFor(host: string): IrcNetwork | null {
  const h = host.toLowerCase().replace(/:\d+$/, '')
  return (
    IRC_NETWORKS.find((n) => {
      const domain = n.host.split('.').slice(-2).join('.')
      return h === n.host || h.endsWith(`.${domain}`) || h === domain
    }) ?? null
  )
}

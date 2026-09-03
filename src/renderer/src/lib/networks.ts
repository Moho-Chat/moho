import liberaLogo from '../assets/irc/libera.svg'
import oftcLogo from '../assets/irc/oftc.png'
import rizonLogo from '../assets/irc/rizon.png'
import quakenetLogo from '../assets/irc/quakenet.png'
import undernetLogo from '../assets/irc/undernet.png'
import hackintLogo from '../assets/irc/hackint.png'
import dalnetLogo from '../assets/irc/dalnet.png'
import coreircLogo from '../assets/irc/coreirc.png'

/**
 * The IRC networks somebody is actually likely to be joining.
 *
 * Typing a hostname and a port correctly is the one step of adding an IRC
 * account where a small mistake looks like the server being down, so the
 * common ones are offered ready-made. Deliberately short: this is a shortcut
 * for the networks people use, not a directory - "Other" is always there and
 * is what every network not on the list uses.
 *
 * Each carries its network's own logo where that network publishes one, taken
 * from the network's own site and bundled rather than fetched: an IRC network
 * is not a CDN, a rail full of tiles should not be a rail full of requests,
 * and half of these sites are plain HTTP. The marks belong to the networks
 * that own them and are used here to identify those networks and nothing
 * else. A network with no logo of its own keeps its initials, which is a
 * better answer than a wrong-looking copy of somebody's artwork.
 *
 * Colours are the network's own where it has a recognisable one. They still
 * matter with a logo present, because they fill the tile behind it - and
 * several of these logos are wordmarks with transparent backgrounds.
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
  /** Two characters at most, for a network with no logo. */
  mark: string
  colour: string
  /** The network's own logo, bundled. Absent where it publishes none. */
  logo?: string
}

export const IRC_NETWORKS: IrcNetwork[] = [
  { id: 'libera', name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, tls: true, mark: 'Li', colour: '#7f4bd8', logo: liberaLogo },
  { id: 'oftc', name: 'OFTC', host: 'irc.oftc.net', port: 6697, tls: true, mark: 'OF', colour: '#2d7ab7', logo: oftcLogo },
  { id: 'rizon', name: 'Rizon', host: 'irc.rizon.net', port: 6697, tls: true, mark: 'Ri', colour: '#c84b4b', logo: rizonLogo },
  { id: 'quakenet', name: 'QuakeNet', host: 'irc.quakenet.org', port: 6667, tls: false, mark: 'QN', colour: '#9f6a20', logo: quakenetLogo },
  { id: 'efnet', name: 'EFnet', host: 'irc.efnet.org', port: 6697, tls: true, mark: 'EF', colour: '#448060' },
  { id: 'undernet', name: 'Undernet', host: 'irc.undernet.org', port: 6697, tls: true, mark: 'UN', colour: '#3f6fa8', logo: undernetLogo },
  { id: 'snoonet', name: 'Snoonet', host: 'irc.snoonet.org', port: 6697, tls: true, mark: 'Sn', colour: '#c54f1f' },
  { id: 'hackint', name: 'hackint', host: 'irc.hackint.org', port: 6697, tls: true, mark: 'hi', colour: '#2f4f4f', logo: hackintLogo },
  { id: 'dalnet', name: 'DALnet', host: 'irc.dal.net', port: 6697, tls: true, mark: 'DA', colour: '#1f4e79', logo: dalnetLogo },
  // The two this client's own users are on. Neither is large, and that is
  // rather the point: a network being small is why nobody else's client
  // offers it ready-made, and typing "irc.coreirc.net" correctly is exactly
  // the step this list exists to remove.
  { id: 'coreirc', name: 'CoreIRC', host: 'irc.coreirc.net', port: 6697, tls: true, mark: 'Co', colour: '#1d5c7a', logo: coreircLogo },
  { id: 'abjects', name: 'Abjects', host: 'irc.abjects.net', port: 6697, tls: true, mark: 'Ab', colour: '#4b4373' }
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

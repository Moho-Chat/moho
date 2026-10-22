import { formatMessage, normalizeBBCode, type ChannelIndex, type SmilieIndex } from './format'

/**
 * The words of a message as they read in the line that quotes it - the one above a reply, or in the bar over the
 * box while one is being written.
 *
 * Those lines showed the original's text as it was stored, so an emote was its code (`[emote:5756632:SUSSY]`), a
 * custom emoji its token, a Steam sticker its name in brackets. Run through the formatter every message is, they
 * draw as what they are. What is left out is what a quote has no room or use for: a link is its words and not
 * something to follow (the line is the way to the original), and a hidden spoiler stays hidden.
 */
export function replyPreviewHtml(
  text: string,
  options: { service?: string; smilies?: SmilieIndex | null; channels?: ChannelIndex | null; ircColours?: boolean } = {}
): string {
  if (!text) return ''
  const sneedchat = options.service === 'sneedchat'
  const html = formatMessage(sneedchat ? normalizeBBCode(text) : text, {
    isSneedchat: sneedchat,
    smilies: options.smilies,
    channels: options.channels,
    markdownEscapes: options.service === 'discord',
    ircFormatting: options.service === 'irc' && options.ircColours ? 'render' : 'strip'
  })
  // Anchors that are not spoilers: their words, with no link.
  return html.replace(/<a href="(?!spoiler:)[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '$1')
}

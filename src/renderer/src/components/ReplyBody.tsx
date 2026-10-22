import { useMemo } from 'react'
import { RichText } from '../lib/richtext'
import { replyPreviewHtml } from '../lib/replypreview'
import { useChat, usePref } from '../state/hooks'
import type { ChannelIndex } from '../lib/format'

/**
 * What a reply is answering, as words: the original's text drawn the way its own line is - its emotes, emoji and
 * stickers as pictures, not as the codes they travel as.
 */
export function ReplyBody({ text, service, channels }: { text: string; service?: string; channels?: ChannelIndex }): JSX.Element {
  const smilies = useChat((s) => s.smilieIndex)
  const [ircColours] = usePref<boolean>('irc.renderColours', true)
  const html = useMemo(() => replyPreviewHtml(text, { service, smilies, channels, ircColours }), [text, service, smilies, channels, ircColours])
  // Ours: the markup is what the formatter built from the text, so the pictures it names are public emote and emoji
  // addresses. A link is not followed from here, and a spoiler is not opened.
  return <RichText html={html} ownMarkup onRevealSpoiler={() => {}} onOpenChannel={() => {}} onOpenLink={() => {}} />
}

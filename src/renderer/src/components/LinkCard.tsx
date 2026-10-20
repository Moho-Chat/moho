import { useMediaUrl } from '../lib/route'
import { useStore } from '../state/hooks'
import { Icon } from './Icon'
import type { Embed } from '../../../shared/wire'

/**
 * The preview of a link as Telegram draws it: the site's name, the page's title and description, its picture, and
 * - where Telegram has made an article of the page - an Instant View button that opens the article in a window of its
 * own. The same card for any link the service previewed; it is only the button that depends on the article.
 */
export function LinkCard({ embed, bufferId, messageId }: { embed: Embed; bufferId: string; messageId: string }): JSX.Element {
  const store = useStore()
  const media = useMediaUrl()
  const instant = embed.kind === 'instant'
  const openPage = (): void => {
    if (embed.url) void window.moho.openExternal(embed.url)
  }
  const openArticle = (): void => {
    window.moho
      .rpc<{ title: string; html: string }>('telegramInstantView', { bufferId, messageId })
      .then((article) => window.moho.openArticle(article.title, article.html))
      .catch((e: Error) => store.toast('error', e.message))
  }
  return (
    <div className="link-card selectable">
      {embed.provider && <div className="link-card-site">{embed.provider}</div>}
      {embed.title && (
        <a
          className="link-card-title"
          href={embed.url}
          onClick={(e) => {
            e.preventDefault()
            openPage()
          }}
        >
          {embed.title}
        </a>
      )}
      {embed.description && <div className="link-card-desc">{embed.description}</div>}
      {embed.imageUrl && (
        <img className="link-card-image" src={media(embed.imageUrl)} alt="" loading="lazy" onClick={instant ? openArticle : openPage} />
      )}
      {instant && (
        <button type="button" className="link-card-instant" onClick={openArticle}>
          <Icon name="bolt" size={15} />
          INSTANT VIEW
        </button>
      )}
    </div>
  )
}

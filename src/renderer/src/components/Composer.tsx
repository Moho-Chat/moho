import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { EmojiPicker } from './EmojiPicker'
import { useActiveBuffer, useChat, useStore } from '../state/hooks'
import { emojiPreview } from '../lib/format'
import { bufferDisplayName, resolveMediaUrl } from '../lib/util'

interface StagedAttachment {
  id: number
  path: string
  name: string
  isImage: boolean
}

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp)$/i

/**
 * What the box holds, as the text that will be sent.
 *
 * An emoji sits in the box as a picture and leaves it as the token the service
 * expects, which is the whole reason this is an editable div rather than an
 * input: an input can hold text and nothing else, so choosing an emoji could
 * only ever put `<:lettyCrazy:1413156421880647762>` in front of the person who
 * chose it.
 */
export function composerText(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node): void => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue ?? ''
      else if (n instanceof HTMLImageElement) out += n.dataset.token ?? ''
      else if (n instanceof HTMLBRElement) out += '\n'
      else if (n.nodeType === Node.ELEMENT_NODE) walk(n)
    })
  }
  walk(root)
  return out
}

/** Caret to the end, which is where anything just inserted belongs. */
function caretToEnd(el: HTMLElement): void {
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * The message input, plus the reply chip, staged attachments, and the Matrix
 * encryption indicator. A fixed bar rather than part of the scrolling message
 * area, so arriving messages can never visually intrude under it.
 */
export function Composer(): JSX.Element | null {
  const store = useStore()
  const buffer = useActiveBuffer()
  const replyingTo = useChat((s) => s.replyingTo)
  const accounts = useChat((s) => s.accounts)
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<StagedAttachment[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const seqRef = useRef(0)
  const inputRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)

  const smilies = useChat((s) => s.smilies)
  const bufferEmojiByBuffer = useChat((s) => s.bufferEmoji)

  const account = buffer && accounts.find((a) => a.id === buffer.accountId)
  const service = account?.service
  // Discord, Sneedchat and Matrix each carry a file natively. IRC has no idea
  // of an attachment at all, so a file there is uploaded and the link sent -
  // which is what people do by hand on IRC anyway, and is why it is offered
  // here rather than left as the one service where the button is dead.
  const supportsAttachments =
    service === 'discord' || service === 'sockchat' || service === 'matrix' || service === 'irc'

  // Refocus on buffer switch so typing works immediately after clicking a
  // channel, without a second click into the field.
  useEffect(() => {
    inputRef.current?.focus()
  }, [buffer?.id])

  if (!buffer) return null

  const stage = (path: string): void => {
    const name = path.split('/').pop() || path
    setStaged((s) => [...s, { id: ++seqRef.current, path, name, isImage: IMAGE_EXTS.test(name) }])
  }

  const submit = (): void => {
    const body = text.trim()
    if (!body && staged.length === 0) return

    if (staged.length > 0) {
      // Each attachment is its own send; the typed text rides along as the
      // caption on the first one, matching how Discord treats a caption.
      staged.forEach((att, i) => {
        void store.sendMessage(buffer.id, i === 0 ? body : '', att.path)
      })
      setStaged([])
    } else {
      void store.sendMessage(buffer.id, body)
    }
    if (inputRef.current) inputRef.current.replaceChildren()
    setText('')
    inputRef.current?.focus()
  }

  /** Puts a picked emoji in the box: as its picture where there is one. */
  const insertEmoji = (token: string): void => {
    const el = inputRef.current
    if (!el) return
    const preview = emojiPreview(token, service === 'sockchat' ? smilies : [])
    if (preview) {
      const img = document.createElement('img')
      img.className = 'composer-emoji'
      img.src = resolveMediaUrl(preview.src)
      img.alt = preview.label
      img.title = preview.label
      // What leaves the box when the message is sent. The picture is for the
      // person typing; the service only ever sees this.
      img.dataset.token = token
      el.appendChild(img)
    } else {
      el.appendChild(document.createTextNode(token))
    }
    setText(composerText(el))
    caretToEnd(el)
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    // Pasting into an editable div would otherwise bring the clipboard's own
    // markup with it - fonts, colours, whole tables. Only the text is wanted.
    // Newlines flattened for the same reason Enter does not make one, and
    // because an input silently did this to a multi-line paste anyway.
    const pasted = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ')
    if (pasted) {
      e.preventDefault()
      // Deprecated, and still the only way to insert at the caret while
      // keeping the box's own undo history intact. Chromium is the only
      // engine this runs on, so its removal is not a live risk.
      document.execCommand('insertText', false, pasted)
      if (inputRef.current) setText(composerText(inputRef.current))
    }
    if (!supportsAttachments) return
    void window.moho.readClipboardImage().then((path) => {
      if (path) stage(path)
    })
  }

  return (
    <div className="composer">
      <div className="divider-h" />

      {replyingTo && (
        <div className="composer-reply small">
          <Icon name="reply" size={14} />
          <span className="ellipsis muted">
            Replying to {replyingTo.from}
            {replyingTo.body ? `: ${replyingTo.body}` : ''}
          </span>
          <IconButton name="close" size={14} title="Cancel reply" onClick={() => store.cancelReply()} />
        </div>
      )}

      {staged.length > 0 && (
        <div className="composer-attachments">
          {staged.map((att) => (
            <div key={att.id} className="staged-thumb" title={att.name}>
              {att.isImage ? (
                <img src={resolveMediaUrl(att.path)} alt={att.name} />
              ) : (
                <div className="staged-file">
                  <Icon name="description" size={22} />
                  <span className="small ellipsis">{att.name}</span>
                </div>
              )}
              <button
                type="button"
                className="staged-remove"
                title="Remove"
                onClick={() => setStaged((s) => s.filter((x) => x.id !== att.id))}
              >
                <Icon name="close" size={13} color="var(--error)" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-row">
        {service === 'matrix' && (
          <Icon
            name={buffer.encrypted ? 'lock' : 'lock_open'}
            size={16}
            color={buffer.encrypted ? 'var(--primary)' : 'var(--surface-variant-text)'}
            style={{ margin: '0 2px' }}
          />
        )}

        <div className="composer-input-wrap">
          {/* Never given children by React: the box's contents are the
              person's, and re-rendering them from state would move the caret
              out from under them on every keystroke. */}
          <div
            ref={inputRef}
            className="text-field composer-input"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={`Message ${bufferDisplayName(buffer.name)}`}
            onInput={(e) => setText(composerText(e.currentTarget))}
            onKeyDown={(e) => {
              // Enter sends and Shift+Enter does nothing, which is what the
              // input this replaced did. An editable div would happily take a
              // second line, but a newline reaching IRC is a malformed
              // PRIVMSG - nothing between here and the socket splits one - so
              // multi-line is a separate change with its own thinking to do.
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!e.shiftKey) submit()
              }
            }}
            onPaste={onPaste}
            // A drop would bring the source's markup in the same way a paste
            // would, and nothing here wants dropped content.
            onDrop={(e) => e.preventDefault()}
          />
          {!text.trim() && (
            <span className="composer-placeholder muted">
              Message {bufferDisplayName(buffer.name)}
            </span>
          )}
        </div>

        <button
          ref={emojiButtonRef}
          type="button"
          className="icon-button"
          title="Emoji"
          onClick={() => setPickerOpen(!pickerOpen)}
        >
          <Icon name="mood" size={18} />
        </button>

        <IconButton
          name="add"
          title={
            supportsAttachments ? 'Attach a file' : "Attachments aren't supported for this service"
          }
          disabled={!supportsAttachments}
          onClick={() => void window.moho.pickFile().then((p) => p && stage(p))}
        />
        <IconButton name="send" title="Send" onClick={submit} />
      </div>

      {pickerOpen && (
        <EmojiPicker
          anchor={emojiButtonRef.current}
          // Only the active buffer's own guild emoji are offered - nobilis
          // already filters that list to what's actually usable there.
          customEmoji={bufferEmojiByBuffer[buffer.id] || []}
          // Recent picks belong to whoever is signed in here, not to the app.
          accountId={account?.id}
          // Smilies are Sneedchat-only; posting a shortcode anywhere else
          // would just send literal text nobody renders.
          smilies={service === 'sockchat' ? smilies : []}
          onSelect={(emoji) => {
            insertEmoji(emoji)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { EmojiPicker } from './EmojiPicker'
import { useActiveBuffer, useChat, useStore } from '../state/hooks'
import { bufferDisplayName, resolveMediaUrl } from '../lib/util'

interface StagedAttachment {
  id: number
  path: string
  name: string
  isImage: boolean
}

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp)$/i

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
  const inputRef = useRef<HTMLInputElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)

  const smilies = useChat((s) => s.smilies)
  const bufferEmojiByBuffer = useChat((s) => s.bufferEmoji)

  const account = buffer && accounts.find((a) => a.id === buffer.accountId)
  const service = account?.service
  // Discord, Sneedchat and Matrix each have a real upload path; IRC has no
  // attachment concept at all, and XMPP/Slack aren't implemented yet.
  const supportsAttachments =
    service === 'discord' || service === 'sockchat' || service === 'matrix'

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
    setText('')
    inputRef.current?.focus()
  }

  const onPaste = async (): Promise<void> => {
    if (!supportsAttachments) return
    // Not preventDefault'd: the browser's own text paste still runs alongside
    // this, and is a no-op for an image-only clipboard entry.
    const path = await window.moho.readClipboardImage()
    if (path) stage(path)
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

        <input
          ref={inputRef}
          className="text-field composer-input"
          placeholder={`Message ${bufferDisplayName(buffer.name)}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={() => void onPaste()}
        />

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
          // Only the active buffer's own guild emoji are offered - chatd
          // already filters that list to what's actually usable there.
          customEmoji={bufferEmojiByBuffer[buffer.id] || []}
          // Smilies are Sneedchat-only; posting a shortcode anywhere else
          // would just send literal text nobody renders.
          smilies={service === 'sockchat' ? smilies : []}
          onSelect={(emoji) => {
            setText((t) => t + emoji)
            setPickerOpen(false)
            inputRef.current?.focus()
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

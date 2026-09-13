import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { Avatar } from './Avatar'
import { EmojiPicker, type StickerEntry } from './EmojiPicker'
import { PlaceField } from './PlaceField'
import { VoiceRecorder } from './VoiceRecorder'
import { useActiveBuffer, useChat, useStore } from '../state/hooks'
import { emojiPreview } from '../lib/format'
import { bufferDisplayName, classes, fileNameOf, isImageFile, resolveMediaUrl } from '../lib/util'
import { completeNick, cyclePrefix, type Completion } from '../lib/completion'
import {
  mentionInsert,
  mentionKeywords,
  mentionQuery,
  rankMentions,
  type MentionTarget
} from '../lib/mentions'

interface StagedAttachment {
  id: number
  path: string
  name: string
  isImage: boolean
}

/**
 * How often to repeat a typing notice while somebody keeps writing.
 *
 * Comfortably inside the ten seconds a notice stands for, so the indicator
 * never lapses mid-sentence, and far enough apart that a fast typist is not
 * sending a request per character.
 */
const TYPING_REPEAT_MS = 4000

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
/**
 * One command that can be typed here, whoever implements it.
 *
 * The daemon answers with its own and the channel's bots' in one list, since
 * somebody typing a slash is asking what happens next rather than which half
 * of the program answers.
 */
interface TypedCommand {
  name: string
  /** `<required> [optional]`, as a manual page would write it. */
  usage?: string
  description?: string
  /** "Built-in", or the bot that answers it. */
  source?: string
  kind: 'builtin' | 'application'
  /** Discord's own description of the command, handed back to run it. */
  command?: { options?: { name: string; type?: number; required?: boolean }[] }
}

export function Composer(): JSX.Element | null {
  const store = useStore()
  const buffer = useActiveBuffer()
  const replyingTo = useChat((s) => s.replyingTo)
  const whisperingTo = useChat((s) => s.whisperingTo)
  const accounts = useChat((s) => s.accounts)
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<StagedAttachment[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  /** The account's sticker packs, fetched when the picker is first opened. */
  const [stickers, setStickers] = useState<StickerEntry[]>([])
  const [stickerPicker, setStickerPicker] = useState(false)
  /** The little form for sending a place, which is a field rather than a map. */
  const [placeOpen, setPlaceOpen] = useState(false)
  const seqRef = useRef(0)
  const typingSentAt = useRef(0)
  /**
   * Who is in this conversation, for completion. Most recent speakers first
   * would be better still; the roster's own order is what is in hand, and a
   * name that matches is far more use than no completion at all.
   */
  useEffect(() => {
    if (!buffer) return
    let live = true
    void window.moho
      .rpc<{ roles: { id: string; name: string; colour?: string }[] }>('listMentionRoles', {
        bufferId: buffer.id
      })
      .then((r) => live && setRoles(r.roles ?? []))
      .catch(() => live && setRoles([]))
    return () => {
      live = false
    }
  }, [buffer?.id])

  const roster = useChat((s) => s.presenceByBuffer)[buffer?.id ?? '']
  const nicks = roster?.map((m) => m.nick) ?? []

  const inputRef = useRef<HTMLDivElement>(null)
  /**
   * Where a completion cycle has got to, or null. A ref rather than state:
   * changing it must not redraw the box somebody is typing in.
   */
  const cycle = useRef<{ last: Completion; attempt: number } | null>(null)
  /** The "@..." being typed, and which suggestion is selected. */
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null)
  /**
   * The slash commands this channel offers, while one is being typed.
   *
   * Asked of the service rather than assembled here: these belong to whatever
   * bots a server has installed, they differ per channel, and there is no
   * list a client could hold. Only Discord has them.
   */
  const [commands, setCommands] = useState<TypedCommand[]>([])
  const [commandIndex, setCommandIndex] = useState(0)
  /**
   * The application command whose name has been completed into the box.
   *
   * Held because what follows it is arguments rather than a message: without
   * this, finishing "/wordle" and pressing Enter would say "/wordle" out loud
   * in the channel. A built-in needs no such memory - the daemon reads those
   * out of the text itself, which is how they have always worked.
   */
  const [pendingCommand, setPendingCommand] = useState<TypedCommand | null>(null)
  /** Discord's mentionable roles here; empty everywhere else. */
  const [roles, setRoles] = useState<{ id: string; name: string; colour?: string }[]>([])
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const stickerButtonRef = useRef<HTMLButtonElement>(null)
  const placeButtonRef = useRef<HTMLButtonElement>(null)

  const smilies = useChat((s) => s.smilies)
  const bufferEmojiByBuffer = useChat((s) => s.bufferEmoji)

  const account = buffer && accounts.find((a) => a.id === buffer.accountId)
  const service = account?.service
  // Discord, Sneedchat and Matrix each carry a file natively. IRC has no idea
  // of an attachment at all, so a file there is uploaded and the link sent -
  // which is what people do by hand on IRC anyway, and is why it is offered
  // here rather than left as the one service where the button is dead.
  const supportsAttachments =
    service === 'discord' || service === 'sneedchat' || service === 'matrix' || service === 'irc'

  // Refocus on buffer switch so typing works immediately after clicking a
  // channel, without a second click into the field.
  useEffect(() => {
    inputRef.current?.focus()
  }, [buffer?.id])

  /**
   * Everything that can be tagged here: the people in the conversation, the
   * roles the service lets anybody ping, and its whole-room keywords.
   */
  const mentionTargets = useMemo((): MentionTarget[] => {
    const members: MentionTarget[] = (roster ?? []).map((m) => ({
      name: m.nick,
      detail: m.userId && m.userId !== m.nick ? undefined : undefined,
      kind: 'member' as const,
      userId: m.userId
    }))
    const roleTargets: MentionTarget[] = roles.map((r) => ({
      name: r.name,
      detail: 'Role',
      colour: r.colour,
      kind: 'role' as const
    }))
    const keywords: MentionTarget[] = mentionKeywords(service).map((k) => ({
      name: k.word,
      detail: k.detail,
      kind: 'keyword' as const
    }))
    return [...members, ...roleTargets, ...keywords]
  }, [roster, roles, service])

  const suggestions = useMemo(
    () => (mention ? rankMentions(mentionTargets, mention.query) : []),
    [mention, mentionTargets]
  )

  // What has been typed as a command, if anything: a slash at the very start
  // and the word after it. Not mid-message - "and/or" is not a command.
  const typedCommand = /^\/\S*$/.test(text) ? text.slice(1) : null

  useEffect(() => {
    if (typedCommand === null || !buffer) {
      setCommands([])
      return
    }
    const timer = setTimeout(() => {
      void window.moho
        .rpc<{ commands: TypedCommand[] }>('listCommands', {
          bufferId: buffer.id,
          query: typedCommand
        })
        .then((answer) => {
          setCommands(answer.commands || [])
          setCommandIndex(0)
        })
        .catch(() => {
          // A channel with no bots answers nothing useful, and a list that
          // could not be read is a list that stays closed rather than a
          // complaint about typing a slash.
          setCommands([])
        })
    }, 200)
    return () => clearTimeout(timer)
  }, [typedCommand, buffer?.id])


  if (!buffer) return null

  /**
   * Tells the service somebody is writing, at most once every few seconds.
   *
   * One notice covers about ten seconds on both protocols that have them, so
   * this is rate-limited rather than sent per keystroke - a request per
   * character would be a lot of traffic to say one thing. The daemon ignores
   * it on services with no such notion, so there is nothing to check here.
   */
  const noteTyping = (): void => {
    const now = Date.now()
    if (now - typingSentAt.current < TYPING_REPEAT_MS) return
    typingSentAt.current = now
    void window.moho.rpc('sendTyping', { bufferId: buffer.id }).catch(() => {})
  }

  const stage = (path: string): void => {
    const name = fileNameOf(path)
    setStaged((s) => [...s, { id: ++seqRef.current, path, name, isImage: isImageFile(name) }])
  }

  const submit = (): void => {
    const body = text.trim()
    if (!body && staged.length === 0) return

    // A command whose name was completed into the box: what follows it is
    // arguments for a bot, not a line to say in the channel. Built-ins fall
    // through to the ordinary send, because the daemon reads those out of
    // the message text itself.
    if (pendingCommand && body.startsWith(`/${pendingCommand.name}`)) {
      runCommand(pendingCommand)
      return
    }

    // Aimed at one person rather than at the room. Attachments are not
    // carried: a whisper is a line of text on this service, and silently
    // posting somebody's picture to the whole room instead would be the worst
    // possible reading of "send".
    if (whisperingTo) {
      const account = store.accountFor(buffer.id)
      if (account) void store.sendWhisper(account.id, whisperingTo, body)
      if (inputRef.current) inputRef.current.replaceChildren()
      setText('')
      return
    }

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
    // Sending is the clearest possible "no longer writing". Matrix can say
    // so; Discord only expires, and ignores the false.
    typingSentAt.current = 0
    void window.moho.rpc('sendTyping', { bufferId: buffer.id, typing: false }).catch(() => {})
    inputRef.current?.focus()
  }

  /** Puts a picked emoji in the box: as its picture where there is one. */
  const insertEmoji = (token: string): void => {
    const el = inputRef.current
    if (!el) return
    const preview = emojiPreview(token, service === 'sneedchat' ? smilies : [])
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
    // Nothing is ever pasted into this box by the browser. Whatever the
    // clipboard holds, what ends up here is decided below.
    //
    // Unconditional, where this used to depend on there being text. A
    // picture with no text alongside it fell through to the default paste
    // and landed in the input at full size - while also being staged in the
    // attachment tray - so it had to be backspaced out before anything could
    // be typed. Refusing the default outright is also steadier than asking
    // whether the clipboard holds an image: the answer here and the answer
    // Electron gives the staging call below come from two different views of
    // the clipboard, and they do not always agree.
    e.preventDefault()

    // Pasting into an editable div would otherwise bring the clipboard's own
    // markup with it - fonts, colours, whole tables. Only the text is wanted.
    // Newlines flattened for the same reason Enter does not make one, and
    // because an input silently did this to a multi-line paste anyway.
    const pasted = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ')
    if (pasted) {
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

  /**
   * Takes the highlighted command: writes its name into the box, and gets out
   * of the way so the arguments can be typed.
   *
   * Completing rather than running, because almost every command takes
   * something after it and a menu that fired on the first press would be a
   * menu you had to avoid. A command that takes nothing has nothing to wait
   * for, so that one runs.
   */
  const takeCommand = (command: TypedCommand): void => {
    const wants = (command.usage ?? '').trim().length > 0
    setCommands([])
    if (!wants && command.kind === 'application') {
      setPendingCommand(command)
      runCommand(command, `/${command.name}`)
      return
    }
    const written = `/${command.name}${wants ? ' ' : ''}`
    setText(written)
    if (inputRef.current) {
      inputRef.current.textContent = written
      // The caret goes to the end, where the next thing typed belongs.
      const range = document.createRange()
      range.selectNodeContents(inputRef.current)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      inputRef.current.focus()
    }
    // Remembered only for the ones this client has to run itself; a built-in
    // is read out of the message text by the daemon, the way it always was.
    setPendingCommand(command.kind === 'application' ? command : null)
  }

  /**
   * Runs an application command with whatever was typed after its name, in
   * the order the command declares its arguments.
   *
   * Positional rather than a form: Discord's own client builds one out of the
   * command's description of itself, which is a great deal of interface for
   * something people type. What somebody writes after the name is what they
   * mean by the first argument.
   */
  const runCommand = (command: TypedCommand, typed = text): void => {
    const words = typed.trim().split(/\s+/).slice(1)
    const declared = (command.command?.options ?? []).filter((o) => (o.type ?? 3) <= 10)
    const options = declared
      .map((option, i) => ({ option, word: words[i] }))
      .filter((pair) => pair.word !== undefined)
      .map(({ option, word }) => ({
        type: option.type ?? 3,
        name: option.name,
        // Numbers and booleans are sent as themselves; everything else the
        // service resolves for itself from what was written.
        value:
          option.type === 4 || option.type === 10
            ? Number(word)
            : option.type === 5
              ? word.toLowerCase() === 'true'
              : word
      }))
    const missing = declared.find((o, i) => o.required && words[i] === undefined)
    if (missing) {
      store.toast('info', `/${command.name} needs ${missing.name}`)
      return
    }
    setText('')
    if (inputRef.current) inputRef.current.textContent = ''
    setCommands([])
    setPendingCommand(null)
    void window.moho
      .rpc('runDiscordCommand', { bufferId: buffer!.id, command: command.command, options })
      .catch((e: Error) => store.toast('error', e.message))
  }

  /** Reads the "@..." at the caret, so the list follows what is being typed. */
  const noteMention = (): void => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection || !node || node.nodeType !== Node.TEXT_NODE) {
      setMention(null)
      return
    }
    const before = (node.textContent ?? '').slice(0, selection.anchorOffset)
    const query = mentionQuery(before)
    setMention(query === null ? null : { query, index: 0 })
  }

  /**
   * Puts a chosen name in the box, in the form its service wants.
   *
   * Replaces the "@query" that was being typed rather than appending, so the
   * half-typed name does not survive its own completion.
   */
  const takeMention = (target: MentionTarget): void => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection || !node || node.nodeType !== Node.TEXT_NODE || !mention) return

    const offset = selection.anchorOffset
    const text = node.textContent ?? ''
    const start = offset - mention.query.length - 1
    if (start < 0) return

    const atLineStart = text.slice(0, start).trim() === ''
    // A keyword is the service's own word and is always written with the "@",
    // even on IRC's own convention - though no IRC service offers one.
    const insert =
      target.kind === 'keyword' ? `@${target.name} ` : mentionInsert(service, target.name, atLineStart)

    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, offset)
    range.deleteContents()
    const inserted = document.createTextNode(insert)
    range.insertNode(inserted)
    range.setStartAfter(inserted)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)

    setMention(null)
    if (inputRef.current) setText(composerText(inputRef.current))
  }

  /**
   * Replaces the word before the caret with a roster name.
   *
   * Works on the text node the caret is in rather than on the component's
   * `text` state, because the box is contenteditable and may hold emoji
   * images: the state is the whole line, and what has to be replaced is a few
   * characters inside one node of it.
   */
  const completeAtCaret = (): void => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection || !node || node.nodeType !== Node.TEXT_NODE) return

    const offset = selection.anchorOffset
    const before = (node.textContent ?? '').slice(0, offset)

    // A second Tab continues from the same prefix - the text now ends in the
    // last completion, not in what was typed.
    const continuing = cyclePrefix(before, cycle.current?.last ?? null)
    const source = continuing ?? before
    const attempt = continuing === null ? 0 : (cycle.current?.attempt ?? 0) + 1

    const completion = completeNick(source, nicks, attempt)
    if (!completion) return

    const range = document.createRange()
    const start = (continuing === null ? offset : offset - (cycle.current?.last.insert.length ?? 0)) - completion.replace
    if (start < 0) return
    range.setStart(node, start)
    range.setEnd(node, offset)
    range.deleteContents()
    const inserted = document.createTextNode(completion.insert)
    range.insertNode(inserted)
    range.setStartAfter(inserted)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)

    cycle.current = { last: completion, attempt }
    if (inputRef.current) setText(composerText(inputRef.current))
  }

  return (
    <div className="composer">
      <div className="divider-h" />

      {/* Who can be tagged, above the box - the same place Discord and Element
          put it, and the only place it can go without covering what is being
          typed. Members first, then roles, then the service's whole-room
          words, because that is the order of how often each is meant. */}
      {/* What can be typed here, and what it takes. Above the box in the
          same place as the name picker, and with the same keys - two lists
          that behaved differently would be two things to learn.

          The heading names what was typed, because a fuzzy match can return
          something that looks nothing like it: "dv" finding "devoice" reads
          as a bug until the line above says what was searched for. */}
      {commands.length > 0 && (
        <div className="command-picker" role="listbox" aria-label="Run a command">
          <div className="command-picker-head small muted">
            Commands matching /{typedCommand}
          </div>
          {commands.map((c, i) => (
            <button
              key={`${c.kind}:${c.name}`}
              type="button"
              role="option"
              aria-selected={i === commandIndex}
              className={classes('command-option', i === commandIndex && 'active')}
              onMouseDown={(e) => {
                e.preventDefault()
                takeCommand(c)
              }}
              onMouseEnter={() => setCommandIndex(i)}
            >
              <span className="command-glyph">
                <Icon name="terminal" size={16} />
              </span>
              <span className="command-text">
                <span className="command-name ellipsis">
                  /{c.name}
                  {c.usage && <span className="command-usage"> {c.usage}</span>}
                </span>
                {c.description && <span className="small muted ellipsis">{c.description}</span>}
              </span>
              {c.source && <span className="small muted command-source">{c.source}</span>}
            </button>
          ))}
        </div>
      )}

      {mention && suggestions.length > 0 && (
        <div className="mention-picker" role="listbox" aria-label="Tag somebody">
          {suggestions.map((target, i) => (
            <button
              key={`${target.kind}:${target.name}`}
              type="button"
              role="option"
              aria-selected={i === mention.index}
              className={classes('mention-option', i === mention.index && 'active')}
              // Chosen on mousedown rather than click: a click would first
              // move focus out of the box, and the caret with it.
              onMouseDown={(e) => {
                e.preventDefault()
                takeMention(target)
              }}
              onMouseEnter={() => setMention({ ...mention, index: i })}
            >
              {target.kind === 'member' ? (
                <Avatar name={target.name} size={20} />
              ) : (
                <span className="mention-glyph" style={target.colour ? { color: target.colour } : undefined}>
                  <Icon name={target.kind === 'role' ? 'group' : 'campaign'} size={16} />
                </span>
              )}
              <span className="ellipsis" style={target.colour ? { color: target.colour } : undefined}>
                {target.kind === 'keyword' ? `@${target.name}` : target.name}
              </span>
              {target.detail && <span className="small muted ellipsis mention-detail">{target.detail}</span>}
            </button>
          ))}
        </div>
      )}

      <TypingLine bufferId={buffer.id} />

      {whisperingTo && (
        <div className="composer-reply composer-whisper small">
          <Icon name="lock" size={14} />
          <span className="ellipsis muted">
            Whispering to {whisperingTo} - only they will see this
          </span>
          <IconButton name="close" size={14} title="Stop whispering" onClick={() => store.cancelWhisper()} />
        </div>
      )}

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
            onInput={(e) => {
              setText(composerText(e.currentTarget))
              noteTyping()
              noteMention()
            }}
            onKeyDown={(e) => {
              // Enter sends and Shift+Enter does nothing, which is what the
              // input this replaced did. An editable div would happily take a
              // second line, but a newline reaching IRC is a malformed
              // PRIVMSG - nothing between here and the socket splits one - so
              // multi-line is a separate change with its own thinking to do.
              // While the mention list is up it owns the keys somebody is
              // already using to drive it - a list you steer with the arrows
              // and take with Enter is one nobody has to be taught.
              if (commands.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : commands.length - 1
                  setCommandIndex((commandIndex + step) % commands.length)
                  return
                }
                // Both take it, and taking it means writing it into the box
                // rather than firing it: almost every command wants something
                // after its name.
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  takeCommand(commands[commandIndex])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setCommands([])
                  return
                }
              }
              if (mention && suggestions.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : suggestions.length - 1
                  setMention({ ...mention, index: (mention.index + step) % suggestions.length })
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  takeMention(suggestions[mention.index])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMention(null)
                  return
                }
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!e.shiftKey) submit()
                return
              }
              // Tab completes the name being typed, and completes it again on
              // the next press. Every IRC client does this and nothing here
              // did: on a network where people are called `[Fish]tank_` or
              // `nick|away`, typing a name exactly is most of the work of
              // saying anything to anyone.
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                completeAtCaret()
              }
            }}
            onPaste={onPaste}
            // A drop would bring the source's markup in the same way a paste
            // would, and nothing goes into this box that way. A file dropped
            // here still lands somewhere - FileDrop takes it from the window
            // and asks where it should go - which is why this only refuses
            // the default rather than stopping the event.
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
          onClick={() => {
            setStickerPicker(false)
            setPickerOpen(!pickerOpen)
          }}
        >
          <Icon name="mood" size={18} />
        </button>

        {/* Its own button beside the emoji one, because it is its own
            gesture: an emoji goes into the line being written and a sticker
            is the message. Only where the service has them - which today is
            Matrix, and where a pack is what supplies them. */}
        {service === 'matrix' && (
          <button
            ref={stickerButtonRef}
            type="button"
            className="icon-button"
            title="Stickers"
            onClick={() => {
              const opening = !stickerPicker
              setPickerOpen(false)
              setStickerPicker(opening)
              // Asked for when the picker opens rather than kept in sync: a
              // pack changes about as often as somebody adds one, and the
              // images are cached by the time they are drawn twice.
              if (opening) {
                void window.moho
                  .rpc<StickerEntry[]>('listMatrixStickers', { bufferId: buffer.id })
                  .then(setStickers)
                  .catch(() => setStickers([]))
              }
            }}
          >
            <Icon name="sticky_note_2" size={18} />
          </button>
        )}

        {/* Beside the sticker button for the same reason it is beside the
            emoji one: a location is the message rather than something typed
            into it. Matrix only, which is the one service here that carries
            a place as its own kind of message. */}
        {service === 'matrix' && (
          <button
            ref={placeButtonRef}
            type="button"
            className="icon-button"
            title="Send a location"
            onClick={() => {
              setPickerOpen(false)
              setStickerPicker(false)
              setPlaceOpen(!placeOpen)
            }}
          >
            <Icon name="location_on" size={18} />
          </button>
        )}

        {/* Saying it rather than typing it. Discord only, because it is the
            one service here whose voice messages this speaks - Matrix shapes
            them differently and is its own piece of work. */}
        {service === 'discord' && <VoiceRecorder bufferId={buffer.id} />}

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

      {placeOpen && (
        <PlaceField
          anchor={placeButtonRef.current}
          onClose={() => setPlaceOpen(false)}
          onSend={(place, label) => {
            setPlaceOpen(false)
            void window.moho
              .rpc('sendMatrixLocation', { bufferId: buffer.id, place, label })
              .catch((e: Error) => store.toast('error', e.message))
          }}
        />
      )}

      {stickerPicker && (
        <EmojiPicker
          anchor={stickerButtonRef.current}
          stickersOnly
          stickers={stickers}
          accountId={account?.id}
          onSticker={(sticker) => {
            setStickerPicker(false)
            void window.moho
              .rpc('sendMatrixSticker', { bufferId: buffer.id, mxc: sticker.mxc, body: sticker.body })
              .catch((e: Error) => store.toast('error', e.message))
          }}
          onSelect={() => setStickerPicker(false)}
          onClose={() => setStickerPicker(false)}
        />
      )}

      {pickerOpen && (
        <EmojiPicker
          anchor={emojiButtonRef.current}
          // Which conversation this is for. The picker asks the daemon what
          // this account can send anywhere, and the answer says which of it
          // reaches here - see #205.
          bufferId={buffer.id}
          // Only reached with a daemon too old to answer that, where this is
          // what the picker showed before it asked.
          customEmoji={bufferEmojiByBuffer[buffer.id] || []}
          // Recent picks belong to whoever is signed in here, not to the app.
          accountId={account?.id}
          // Smilies are Sneedchat-only; posting a shortcode anywhere else
          // would just send literal text nobody renders.
          smilies={service === 'sneedchat' ? smilies : []}
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

/**
 * "Anna is typing…", under the divider and above the box.
 *
 * Expiry is on a timer rather than only on the next event, because the last
 * word somebody types produces no further notice: Discord never says anybody
 * stopped, and a Matrix client that closes mid-sentence never sends its
 * cancel. Without this the line would sit there indefinitely.
 */
function TypingLine({ bufferId }: { bufferId: string }): JSX.Element | null {
  const entry = useChat((s) => s.typingByBuffer[bufferId])
  const [, tick] = useState(0)

  useEffect(() => {
    if (!entry) return
    const left = entry.until - Date.now()
    if (left <= 0) return
    const t = setTimeout(() => tick((n) => n + 1), left)
    return () => clearTimeout(t)
  }, [entry])

  if (!entry || entry.until <= Date.now() || entry.nicks.length === 0) return null

  const names = entry.nicks
  const who =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`

  return (
    <div className="composer-typing small muted ellipsis" aria-live="polite">
      {who}…
    </div>
  )
}

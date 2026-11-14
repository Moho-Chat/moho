import { useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'
import { fileNameOf } from '../lib/util'

/**
 * Posting a story to a Signal group: words on a coloured card, or a picture or video with words under it. Its members
 * see it for a day. Only a group's story is offered: My Story is sent to lists the phone keeps, which moho does not.
 */
export function StoryComposer({ bufferId, onClose }: { bufferId: string; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [text, setText] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [replies, setReplies] = useState(true)
  const [sending, setSending] = useState(false)
  const ready = !!path || text.trim().length > 0

  const send = (): void => {
    setSending(true)
    void window.moho
      .rpc('postSignalStory', { bufferId, text: text.trim(), ...(path ? { path } : {}), allowReplies: replies })
      .then(() => {
        store.toast('info', 'Posted to the group story')
        onClose()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setSending(false))
  }

  return (
    <Modal title="Post to the group's story" icon="auto_stories" className="modal poll-composer" onClose={onClose}>
      <label className="field">
        <span className="small muted">{path ? 'Words under it (optional)' : 'Words'}</span>
        <textarea className="text-field" rows={3} maxLength={700} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="field-row">
        <button
          type="button"
          className="button subtle small"
          onClick={() =>
            void window.moho.pickFile(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm']).then((picked) => {
              if (picked) setPath(picked)
            })
          }
        >
          {path ? 'Another picture…' : 'Add a picture or video…'}
        </button>
        {path && (
          <>
            <span className="small ellipsis">{fileNameOf(path)}</span>
            <button type="button" className="button subtle small" onClick={() => setPath(null)}>
              Words only
            </button>
          </>
        )}
      </div>
      <label className="small poll-disclosed">
        <input type="checkbox" checked={replies} onChange={(e) => setReplies(e.target.checked)} />
        Let people reply and react
      </label>
      <div className="small muted">Members of the group see it for 24 hours.</div>
      <div className="field-row">
        <button type="button" className="button" disabled={!ready || sending} onClick={send}>
          {sending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </Modal>
  )
}

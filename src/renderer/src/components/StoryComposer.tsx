import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useChat, useStore } from '../state/hooks'
import { fileNameOf } from '../lib/util'

interface StoryList {
  id: string
  name: string
  myStory: boolean
  count: number
  replies: boolean
}

/**
 * Posting a story: words on a coloured card, or a picture or video with words under it, seen for a day. From a group's
 * conversation it goes to that group; from Stories it goes to My Story or one of the lists made on the phone, whose
 * members (and, for My Story, its "all connections except" choice) are the phone's.
 */
export function StoryComposer({ bufferId, onClose }: { bufferId: string; onClose: () => void }): JSX.Element {
  const store = useStore()
  const account = store.accountFor(bufferId)
  const toLists = useChat((s) => s.buffers.find((b) => b.id === bufferId)?.remoteId === 'stories')
  const [lists, setLists] = useState<StoryList[] | null>(null)
  const [listId, setListId] = useState('')
  useEffect(() => {
    if (!toLists || !account) return
    void window.moho
      .rpc<StoryList[]>('signalStoryLists', { accountId: account.id })
      .then((got) => {
        setLists(got)
        setListId(got[0]?.id ?? '')
      })
      .catch((e: Error) => store.toast('error', e.message))
  }, [toLists, account, store])
  const chosen = lists?.find((l) => l.id === listId)
  const [text, setText] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [replies, setReplies] = useState(true)
  const [sending, setSending] = useState(false)
  const ready = (!!path || text.trim().length > 0) && (!toLists || (!!chosen && chosen.count > 0))

  const send = (): void => {
    setSending(true)
    void window.moho
      .rpc(
        'postSignalStory',
        toLists
          ? { accountId: account?.id, listId, text: text.trim(), ...(path ? { path } : {}) }
          : { bufferId, text: text.trim(), ...(path ? { path } : {}), allowReplies: replies }
      )
      .then(() => {
        store.toast('info', toLists ? `Posted to ${chosen?.name ?? 'the story'}` : 'Posted to the group story')
        onClose()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setSending(false))
  }

  return (
    <Modal title={toLists ? 'Post a story' : "Post to the group's story"} icon="auto_stories" className="modal poll-composer" onClose={onClose}>
      {toLists && (
        <label className="field">
          <span className="small muted">Who sees it</span>
          {lists === null ? (
            <span className="small muted">Looking…</span>
          ) : lists.length === 0 ? (
            <span className="small muted">No story lists are known yet: the phone keeps them, and they arrive with its settings.</span>
          ) : (
            <select className="text-field" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.count === 1 ? '1 person' : `${l.count} people`})
                </option>
              ))}
            </select>
          )}
        </label>
      )}
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
      {toLists ? (
        <div className="small muted">
          {chosen && chosen.count === 0
            ? `${chosen.name} reaches nobody yet: choose who sees it on your phone.`
            : 'They see it for 24 hours. Whether they can reply is the list’s own setting, made on the phone.'}
        </div>
      ) : (
        <>
          <label className="small poll-disclosed">
            <input type="checkbox" checked={replies} onChange={(e) => setReplies(e.target.checked)} />
            Let people reply and react
          </label>
          <div className="small muted">Members of the group see it for 24 hours.</div>
        </>
      )}
      <div className="field-row">
        <button type="button" className="button" disabled={!ready || sending} onClick={send}>
          {sending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </Modal>
  )
}

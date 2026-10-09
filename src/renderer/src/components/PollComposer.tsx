import { useState } from 'react'
import { IconButton } from './Icon'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'

/** The spec's own ceiling, so twenty-one answers is refused here not there. */
const MAX_ANSWERS = 20

/**
 * Starting a poll.
 *
 * moho has read and voted in Matrix polls since they were supported without
 * ever being able to make one, so a poll in a room always began somewhere
 * else. This is the missing end.
 *
 * Two answers to begin with, because that is the smallest poll there is and
 * the shape tells somebody what to do without a word of instruction.
 */
export function PollComposer({ bufferId, onClose }: { bufferId: string; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', ''])
  const [disclosed, setDisclosed] = useState(true)
  const [sending, setSending] = useState(false)

  const filled = answers.map((a) => a.trim()).filter(Boolean)
  const ready = question.trim().length > 0 && filled.length >= 2

  const send = (): void => {
    setSending(true)
    void window.moho
      .rpc('startMatrixPoll', { bufferId, question: question.trim(), answers: filled, disclosed })
      .then(onClose)
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setSending(false))
  }

  return (
    <Modal title="New poll" icon="ballot" className="modal poll-composer" onClose={onClose}>

        <label className="field">
          <span className="small muted">Question</span>
          <input
            className="text-field"
            value={question}
            autoFocus
            placeholder="What are we deciding?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>

        <div className="poll-answers">
          {answers.map((answer, i) => (
            <div key={i} className="poll-answer">
              <input
                className="text-field"
                value={answer}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => setAnswers(answers.map((a, j) => (i === j ? e.target.value : a)))}
              />
              {/* Never below two, which is the smallest poll that means
                  anything - so the control is absent rather than present and
                  refusing. */}
              {answers.length > 2 && (
                <IconButton
                  name="close"
                  size={15}
                  title="Remove this answer"
                  onClick={() => setAnswers(answers.filter((_, j) => j !== i))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="field-row">
          <button
            type="button"
            className="button subtle small"
            disabled={answers.length >= MAX_ANSWERS}
            onClick={() => setAnswers([...answers, ''])}
          >
            Add an answer
          </button>
          <label className="small poll-disclosed">
            <input type="checkbox" checked={disclosed} onChange={(e) => setDisclosed(e.target.checked)} />
            {/* Said as what it does rather than as its name in the spec:
                "undisclosed" is the kind of word that makes somebody guess. */}
            Show the running count before it closes
          </label>
        </div>

        <div className="field-row">
          <button type="button" className="button" disabled={!ready || sending} onClick={send}>
            {sending ? 'Starting…' : 'Start the poll'}
          </button>
        </div>
    </Modal>
  )
}

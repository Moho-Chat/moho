import { useState } from 'react'
import { Icon, IconButton } from './Icon'
import { classes } from '../lib/util'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'

/** The spec's own ceiling, so twenty-one answers is refused here not there. */
const MAX_ANSWERS = 20
/** Telegram's: ten answers, and a count that can be held back until the poll closes. */
const TELEGRAM_MAX_ANSWERS = 10
/** Signal's: ten answers, and a choice of whether more than one may be picked (its tally is always shown). */
const SIGNAL_MAX_ANSWERS = 10

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
  const service = store.accountFor(bufferId)?.service
  const max = service === 'telegram' ? TELEGRAM_MAX_ANSWERS : service === 'signal' ? SIGNAL_MAX_ANSWERS : MAX_ANSWERS
  const signal = service === 'signal'
  const [multiple, setMultiple] = useState(false)
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', ''])
  const [disclosed, setDisclosed] = useState(true)
  const [sending, setSending] = useState(false)

  /** Moves an answer up or down the list: the order they are written in is the order they are offered in. */
  const move = (i: number, by: number): void => {
    const next = [...answers]
    const [taken] = next.splice(i, 1)
    next.splice(i + by, 0, taken)
    setAnswers(next)
  }

  const filled = answers.map((a) => a.trim()).filter(Boolean)
  const ready = question.trim().length > 0 && filled.length >= 2

  const send = (): void => {
    setSending(true)
    void window.moho
      .rpc('startMatrixPoll', { bufferId, question: question.trim(), answers: filled, disclosed, multiple })
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
          <span className="small muted">Answers</span>
          {answers.map((answer, i) => (
            <div key={i} className="poll-answer">
              <span className="poll-answer-number small muted">{i + 1}</span>
              <input
                className="text-field"
                value={answer}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => setAnswers(answers.map((a, j) => (i === j ? e.target.value : a)))}
                onKeyDown={(e) => {
                  // Enter on the last one asks for another, which is what somebody listing things does next.
                  if (e.key === 'Enter' && i === answers.length - 1 && answer.trim() && answers.length < max) setAnswers([...answers, ''])
                }}
              />
              <IconButton name="arrow_upward" size={15} title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton name="arrow_downward" size={15} title="Move down" disabled={i === answers.length - 1} onClick={() => move(i, 1)} />
              {/* Never below two, which is the smallest poll that means
                  anything - so the control is disabled there rather than
                  refusing when pressed. */}
              <IconButton
                name="close"
                size={15}
                title={answers.length > 2 ? 'Remove this answer' : 'A poll needs two answers'}
                disabled={answers.length <= 2}
                onClick={() => setAnswers(answers.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <button type="button" className="button quiet poll-add" disabled={answers.length >= max} onClick={() => setAnswers([...answers, ''])}>
            <Icon name="add" size={16} /> Add an answer
            <span className="small muted">
              {answers.length} of {max}
            </span>
          </button>
        </div>

        <div className="switch-row poll-switch">
          {signal ? (
            <span className="switch-text">
              <span>Allow more than one answer</span>
            </span>
          ) : (
            <span className="switch-text">
              {/* Said as what it does rather than as its name in the spec:
                  "undisclosed" is the kind of word that makes somebody guess. */}
              <span>Show the running count</span>
              <span className="small muted">Off, nobody sees how it is going until the poll closes</span>
            </span>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={signal ? multiple : disclosed}
            className={classes('switch', (signal ? multiple : disclosed) && 'on')}
            onClick={() => (signal ? setMultiple(!multiple) : setDisclosed(!disclosed))}
          >
            <span className="switch-knob" />
          </button>
        </div>

        <div className="reason-prompt-actions">
          <button type="button" className="button subtle" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!ready || sending} onClick={send}>
            {sending ? 'Starting…' : 'Start the poll'}
          </button>
        </div>
    </Modal>
  )
}

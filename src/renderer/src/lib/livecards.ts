import type { LiveCard } from '../state/store'

/** Where a card is: taking answers, closed to them and waiting (a prediction), decided, or called off. */
export type CardStage = 'open' | 'locked' | 'decided' | 'cancelled'

/** The stage, from what the service says, or else from the clock and whether a winner is named. */
export function stageOf(card: Pick<LiveCard, 'kind' | 'state' | 'options'>, open: boolean): CardStage {
  const state = (card.state ?? '').toLowerCase()
  if (state === 'canceled' || state === 'cancelled') return 'cancelled'
  if (state === 'resolved' || card.options.some((o) => o.winner)) return 'decided'
  if (state === 'locked') return 'locked'
  if (open) return 'open'
  return card.kind === 'prediction' ? 'locked' : 'decided'
}

/** A poll's winners once it has ended: the answers with the most votes (more than one is a tie); none without votes. */
export function pollWinners(card: Pick<LiveCard, 'options'>): (string | number)[] {
  const named = card.options.filter((o) => o.winner)
  if (named.length) return named.map((o) => o.id)
  const top = Math.max(0, ...card.options.map((o) => o.votes))
  return top > 0 ? card.options.filter((o) => o.votes === top).map((o) => o.id) : []
}

/** A share of what can be bet, as the ⅛ ¼ ½ All buttons put it: whole points, never under the smallest bet. */
export function fractionOf(balance: number, part: number, minBet: number): number {
  return Math.max(minBet, Math.floor(balance * part))
}


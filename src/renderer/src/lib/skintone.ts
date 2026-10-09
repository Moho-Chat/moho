/**
 * Skin tones for the emoji that take them.
 *
 * A tone is one more character after the emoji (U+1F3FB to U+1F3FF), so
 * applying one is text work and every service that carries Unicode carries
 * the result. 0 is the yellow every emoji starts as.
 */

/** The five modifiers, light to dark; index 0 of `TONES` is none. */
const MODIFIERS = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

/** What each choice looks like in the selector: a hand drawn in it. */
export const TONES = ['👋', ...MODIFIERS.map((m) => `👋${m}`)]

/** The tone of one name, for a label. */
export const TONE_NAMES = ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']

/** The emoji in the picker that have tones to take: hands, mostly. */
const TAKES_TONE = new Set(['👍', '👎', '👏', '🙏', '💪', '🤝', '👋', '🙌', '👌', '✌', '🤞', '🫶', '👊', '✊'])

/** The emoji with its tone applied, or as it was if it takes none. */
export function withTone(emoji: string, tone: number): string {
  if (tone <= 0 || tone > MODIFIERS.length) return emoji
  // The variation selector that asks for the picture form comes off: the
  // tone is what makes it one.
  const base = emoji.replace(/️$/, '')
  return TAKES_TONE.has(base) ? base + MODIFIERS[tone - 1] : emoji
}

/** Whether a tone would change this one, so the picker knows to say so. */
export function takesTone(emoji: string): boolean {
  return TAKES_TONE.has(emoji.replace(/️$/, ''))
}

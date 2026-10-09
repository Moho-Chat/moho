/**
 * Turning a key press into the Electron accelerator the global hotkey is
 * stored as ("Control+Shift+M"), and back into something to read.
 */

const NAMED: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert'
}

/**
 * The accelerator for a key press, or null while it is only modifiers so far
 * or is not one a global shortcut can be: it needs a key that is not a
 * modifier, and at least one modifier, or it would take that key from every
 * other program.
 */
export function acceleratorOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Dead'].includes(e.key)) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  if (mods.length === 0) return null
  let key: string | undefined = NAMED[e.key]
  if (!key && /^F\d{1,2}$/.test(e.key)) key = e.key
  // The physical key, not what it types: Shift+1 is "1" here and "!" in the
  // event, and an accelerator naming "!" is one the system does not know.
  if (!key && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  if (!key && /^Digit\d$/.test(e.code)) key = e.code.slice(5)
  if (!key && e.key.length === 1) key = e.key.toUpperCase()
  return key ? [...mods, key].join('+') : null
}

/** "Control+Shift+M" as the keys read on a cap. */
export function acceleratorLabel(accelerator: string): string[] {
  return accelerator.split('+').map((part) => (part === 'Super' ? 'Meta' : part === 'Return' ? 'Enter' : part))
}

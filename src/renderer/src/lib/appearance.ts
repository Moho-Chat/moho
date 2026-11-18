/**
 * The window's colours: dark or light, and which colour does the pointing
 * (#339). Every colour in the stylesheets is a token, so a theme is a second
 * set of values for them - see theme.css - and an accent is one of them
 * changed, with the ones made from it following.
 */
export type ThemeChoice = 'dark' | 'light' | 'system'

export interface Accent {
  id: string
  label: string
  /** On the dark surfaces, and on the light ones, where the same colour would be too pale to read. */
  dark: string
  light: string
}

/** Blue is the one the tokens are written for; choosing it sets nothing. */
export const ACCENTS: Accent[] = [
  { id: 'blue', label: 'Blue', dark: '#42a5f5', light: '#1565c0' },
  { id: 'teal', label: 'Teal', dark: '#2ec4b6', light: '#00796b' },
  { id: 'green', label: 'Green', dark: '#5fcf80', light: '#2e7d32' },
  { id: 'amber', label: 'Amber', dark: '#f0b232', light: '#a15c00' },
  { id: 'rose', label: 'Rose', dark: '#f06292', light: '#c2185b' },
  { id: 'violet', label: 'Violet', dark: '#b388ff', light: '#6a3fc4' }
]

/** Which of the two a choice comes to, given what the system is set to. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): 'dark' | 'light' {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
}

/** The custom properties an accent sets on the root, or none for the default. */
export function accentProperties(accentId: string, theme: 'dark' | 'light'): Record<string, string> {
  const accent = ACCENTS.find((a) => a.id === accentId)
  if (!accent || accent.id === 'blue') return {}
  const colour = accent[theme]
  return {
    '--primary': colour,
    '--secondary': `color-mix(in srgb, ${colour} 70%, ${theme === 'dark' ? '#fff' : '#000'})`,
    '--primary-container': `color-mix(in srgb, ${colour} 45%, ${theme === 'dark' ? '#000' : '#fff'})`
  }
}

const ACCENT_PROPERTIES = ['--primary', '--secondary', '--primary-container']

/** Puts the chosen theme and accent on a document's root. */
export function applyAppearance(root: HTMLElement, theme: 'dark' | 'light', accentId: string): void {
  if (theme === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
  for (const name of ACCENT_PROPERTIES) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(accentProperties(accentId, theme))) root.style.setProperty(name, value)
}

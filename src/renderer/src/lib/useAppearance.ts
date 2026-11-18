import { useEffect } from 'react'
import { usePref } from '../state/hooks'
import { applyAppearance, resolveTheme, type ThemeChoice } from './appearance'

/** Keeps this window's colours as the settings say, and as the system says where it was left to the system. */
export function useAppearance(): void {
  const [choice] = usePref<ThemeChoice>('appearance.theme', 'dark')
  const [accent] = usePref<string>('appearance.accent', 'blue')
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => applyAppearance(document.documentElement, resolveTheme(choice, system.matches), accent)
    apply()
    if (choice !== 'system') return
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [choice, accent])
}

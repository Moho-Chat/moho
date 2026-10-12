import { useEffect } from 'react'
import { useChat, usePref, usePrefsReady } from './hooks'
import { DM_GROUP_ID } from '../lib/groups'
import type { CustomCategory } from '../lib/categories'
import { planDmCategories } from '../lib/dmcategories'

// Held at module level: a fresh array as a fallback each render reads as a
// change every time.
const NO_CATEGORIES: Record<string, CustomCategory[]> = {}
const NO_ASSIGNMENT: Record<string, string> = {}
const NO_IDS: string[] = []

/**
 * Keeps the direct-messages page sorted by account. See lib/dmcategories.ts
 * for what it does and, as much, what it leaves alone.
 *
 * Mounted once, in the main window: it writes the same preferences the page
 * reads, and a second window doing it too would be two writers.
 */
export function useDmCategories(): void {
  const ready = usePrefsReady()
  const accounts = useChat((s) => s.accounts)
  const buffers = useChat((s) => s.buffers)
  const [categories, setCategories] = usePref<Record<string, CustomCategory[]>>('customCategories', NO_CATEGORIES)
  const [assignment, setAssignment] = usePref<Record<string, string>>('channelCategory', NO_ASSIGNMENT)
  const [filed, setFiled] = usePref<string[]>('dmAutoFiled', NO_IDS)
  const [made, setMade] = usePref<string[]>('dmHeadingsMade', NO_IDS)

  useEffect(() => {
    if (!ready) return
    const plan = planDmCategories(accounts, buffers, {
      categories: categories[DM_GROUP_ID] ?? [],
      assignment,
      filed,
      made
    })
    if (!plan) return
    setCategories({ ...categories, [DM_GROUP_ID]: plan.categories })
    setAssignment(plan.assignment)
    setFiled(plan.filed)
    setMade(plan.made)
  }, [ready, accounts, buffers, categories, assignment, filed, made, setCategories, setAssignment, setFiled, setMade])
}

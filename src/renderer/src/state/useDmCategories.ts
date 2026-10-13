import { useEffect } from 'react'
import { useChat, usePref, usePrefsReady } from './hooks'
import { DM_GROUP_ID } from '../lib/groups'
import type { CustomCategory } from '../lib/categories'
import { planDmCategories } from '../lib/dmcategories'
import { seedSteamFolders } from '../lib/steamgroups'
import { useStore } from './hooks'

// Held at module level: a fresh array as a fallback each render reads as a
// change every time.
const NO_CATEGORIES: Record<string, CustomCategory[]> = {}
const NO_ASSIGNMENT: Record<string, string> = {}
const NO_IDS: string[] = []
const NO_NAMES: Record<string, string> = {}
const NO_FOLLOWED: { names?: Record<string, string> } = {}

/**
 * Keeps the direct-messages page sorted by account. See lib/dmcategories.ts
 * for what it does and, as much, what it leaves alone.
 *
 * Mounted once, in the main window: it writes the same preferences the page
 * reads, and a second window doing it too would be two writers.
 */
export function useDmCategories(): void {
  const ready = usePrefsReady()
  const store = useStore()
  const accounts = useChat((s) => s.accounts)
  const buffers = useChat((s) => s.buffers)
  const steamGroups = useChat((s) => s.steamGroups)
  const [categories, setCategories] = usePref<Record<string, CustomCategory[]>>('customCategories', NO_CATEGORIES)
  const [assignment, setAssignment] = usePref<Record<string, string>>('channelCategory', NO_ASSIGNMENT)
  const [filed, setFiled] = usePref<string[]>('dmAutoFiled', NO_IDS)
  const [made, setMade] = usePref<string[]>('dmHeadingsMade', NO_IDS)
  const [seeded, setSeeded] = usePref<string[]>('steamFoldersSeeded', NO_IDS)
  // What the headings were last called while they were followed, which is only read to tidy them once.
  const [followed] = usePref<{ names?: Record<string, string> }>('steamGroupSync', NO_FOLLOWED)

  // A Steam account's groups, asked for when it connects: it also says them on
  // its own, but not necessarily after this window is listening.
  const connectedSteam = accounts.filter((a) => a.service === 'steam' && a.state === 'connected').map((a) => a.id).join(',')
  useEffect(() => {
    for (const id of connectedSteam.split(',').filter(Boolean)) store.loadSteamGroups(id)
  }, [connectedSteam, store])

  useEffect(() => {
    if (!ready) return
    // The account headings first, then the Steam groups on top of what they
    // made: one write for both, so neither is lost to the other.
    const dm = planDmCategories(accounts, buffers, {
      categories: categories[DM_GROUP_ID] ?? [],
      assignment,
      filed,
      made
    })
    const steam = seedSteamFolders(accounts, buffers, steamGroups, {
      categories: dm?.categories ?? categories[DM_GROUP_ID] ?? [],
      assignment: dm?.assignment ?? assignment,
      seeded,
      followedNames: followed.names ?? NO_NAMES
    })
    if (!dm && !steam) return
    const next = steam ?? dm!
    setCategories({ ...categories, [DM_GROUP_ID]: next.categories })
    setAssignment(next.assignment)
    if (dm) {
      setFiled(dm.filed)
      setMade(dm.made)
    }
    if (steam) setSeeded(steam.seeded)
  }, [ready, accounts, buffers, steamGroups, categories, assignment, filed, made, seeded, followed, setCategories, setAssignment, setFiled, setMade, setSeeded])
}

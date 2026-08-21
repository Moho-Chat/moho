import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { store, type ChatState } from './store'

/**
 * Slice subscription. The selector must return something referentially stable
 * across unrelated updates - i.e. a field off the state object, not a freshly
 * built array - or React will re-render on every store change.
 */
export function useChat<T>(selector: (state: ChatState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    useCallback(() => selector(store.getSnapshot()), [selector])
  )
}

export function useStore(): typeof store {
  return store
}

const identity = (s: ChatState): ChatState => s

export function useChatState(): ChatState {
  return useChat(identity)
}

/**
 * Durable UI preferences, mirrored from main. Reads are synchronous against a
 * local cache after the initial load; writes go through to main, which is the
 * single owner of the file.
 */
let prefsCache: Record<string, unknown> | null = null
const prefsListeners = new Set<() => void>()

async function ensurePrefsLoaded(): Promise<void> {
  if (prefsCache) return
  prefsCache = await window.moho.prefs.getAll()
  for (const l of prefsListeners) l()
}

export function usePrefsReady(): boolean {
  const [ready, setReady] = useState(prefsCache !== null)
  useEffect(() => {
    if (prefsCache) return
    void ensurePrefsLoaded().then(() => setReady(true))
  }, [])
  return ready
}

export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const subscribe = useCallback((listener: () => void) => {
    prefsListeners.add(listener)
    return () => prefsListeners.delete(listener)
  }, [])
  const getSnapshot = useCallback((): T => {
    if (!prefsCache || !(key in prefsCache)) return fallback
    return prefsCache[key] as T
  }, [key, fallback])

  const value = useSyncExternalStore(subscribe, getSnapshot)

  const setValue = useCallback(
    (next: T) => {
      if (!prefsCache) prefsCache = {}
      prefsCache[key] = next
      void window.moho.prefs.set(key, next)
      for (const l of prefsListeners) l()
    },
    [key]
  )

  return [value, setValue]
}

/** Toggle membership of `id` in a persisted string array (pins, mutes, hides). */
export function useIdSetPref(key: string): [string[], (id: string) => void, (id: string) => boolean] {
  const [list, setList] = usePref<string[]>(key, [])
  const toggle = useCallback(
    (id: string) => {
      setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
    },
    [list, setList]
  )
  const has = useCallback((id: string) => list.includes(id), [list])
  return [list, toggle, has]
}

export function useMapPref<T>(key: string): [Record<string, T>, (k: string, v: T) => void] {
  const [map, setMap] = usePref<Record<string, T>>(key, {})
  const setKey = useCallback((k: string, v: T) => setMap({ ...map, [k]: v }), [map, setMap])
  return [map, setKey]
}

/** The currently open buffer, or null. */
export function useActiveBuffer() {
  const buffers = useChat((s) => s.buffers)
  const activeBufferId = useChat((s) => s.activeBufferId)
  return useMemo(
    () => buffers.find((b) => b.id === activeBufferId) ?? null,
    [buffers, activeBufferId]
  )
}

import { useEffect, useRef, useState } from 'react'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import type { EditAction, EditMenuRequest } from '../../../shared/ipc'
import { usePref } from '../state/hooks'
import { pictureUnderMenu, watchRightClicks } from '../lib/copyimage'
import { DEFAULT_SEARCH_ENGINE, engineName, searchUrl, shortened } from '../lib/searchengines'

/**
 * The right-click menu for anywhere text is typed: the message box, and every
 * field in settings. Chromium says what is misspelled under the pointer and
 * what could replace it; what can be done (undo, cut...) is whatever it says
 * is possible at that caret.
 *
 * Pressing a menu item moves focus to the menu, so the field and what was
 * selected in it are remembered when it opens and put back before acting.
 */
/**
 * The menu for a picture nothing else has a menu for: a right click that
 * reached the top of the page unhandled, over an <img>. The pictures that sit
 * in a message, a profile or a card are handled by their own menus, which
 * add the same entry - this is for everywhere that has none.
 */
export function PictureMenu(): JSX.Element | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const stop = watchRightClicks()
    const on = (e: MouseEvent): void => {
      // Something already answered it.
      if (e.defaultPrevented) return
      if (!pictureUnderMenu()) return
      e.preventDefault()
      setAt({ x: e.clientX, y: e.clientY })
    }
    document.addEventListener('contextmenu', on)
    return () => {
      stop()
      document.removeEventListener('contextmenu', on)
    }
  }, [])
  // An empty list: the menu adds the one entry itself, for the picture that opened it.
  return at ? <ContextMenu x={at.x} y={at.y} entries={[]} onClose={() => setAt(null)} /> : null
}

export function EditMenu(): JSX.Element | null {
  const [menu, setMenu] = useState<EditMenuRequest | null>(null)
  const focus = useRef<{ element: HTMLElement | null; range: Range | null }>({ element: null, range: null })
  const [searchEngine] = usePref<string>('search.engine', DEFAULT_SEARCH_ENGINE)
  const [searchCustom] = usePref<string>('search.customUrl', '')

  useEffect(
    () =>
      window.moho.onEditMenu((request) => {
        const active = document.activeElement
        const selection = window.getSelection()
        focus.current = {
          element: active instanceof HTMLElement ? active : null,
          range: selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
        }
        setMenu(request)
      }),
    []
  )

  if (!menu) return null

  const back = (): void => {
    const { element, range } = focus.current
    element?.focus()
    // An <input> keeps its own selection across a focus change; only a
    // contenteditable has to be told what was selected.
    if (range && element?.isContentEditable) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }
  const act = (action: EditAction) => (): void => {
    back()
    void window.moho.editAction(action)
  }

  const entries: MenuEntry[] = []
  if (menu.word) {
    if (menu.suggestions.length === 0) {
      entries.push({ label: 'No suggestions', disabled: true, onClick: () => {} })
    }
    for (const suggestion of menu.suggestions) {
      entries.push({
        label: suggestion,
        onClick: () => {
          back()
          void window.moho.replaceMisspelling(suggestion)
        }
      })
    }
    entries.push({
      label: 'Add to dictionary',
      icon: 'spellcheck',
      onClick: () => void window.moho.addToDictionary(menu.word)
    })
    entries.push({ separator: true })
  }
  entries.push(
    { label: 'Undo', icon: 'undo', disabled: !menu.can.undo, onClick: act('undo') },
    { label: 'Redo', icon: 'redo', disabled: !menu.can.redo, onClick: act('redo') },
    { separator: true },
    { label: 'Cut', icon: 'content_cut', disabled: !menu.can.cut, onClick: act('cut') },
    { label: 'Copy', icon: 'content_copy', disabled: !menu.can.copy, onClick: act('copy') },
    { label: 'Paste', icon: 'content_paste', disabled: !menu.can.paste, onClick: act('paste') },
    { label: 'Delete', icon: 'delete', disabled: !menu.can.delete, onClick: act('delete') },
    { separator: true },
    { label: 'Select all', icon: 'select_all', disabled: !menu.can.selectAll, onClick: act('selectAll') }
  )
  // Looking up what is selected, in the browser the person already uses.
  const address = searchUrl(menu.selection ?? '', searchEngine, searchCustom)
  if (address) {
    entries.push(
      { separator: true },
      {
        label: `Search ${engineName(searchEngine, searchCustom)} for “${shortened(menu.selection)}”`,
        icon: 'search',
        onClick: () => void window.moho.openExternal(address)
      }
    )
  }

  return <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} />
}

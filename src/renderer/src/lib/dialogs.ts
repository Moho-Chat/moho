/**
 * Where the keyboard is while a dialog is open.
 *
 * Every dialog says `role="dialog" aria-modal="true"`, which is a promise that
 * what is behind it is out of reach - and Tab used to walk straight out of it
 * into the page underneath, and closing it left focus nowhere. One observer
 * here keeps the promise for all of them, so none of the dozen has to: when
 * one appears it takes focus (its own `autofocus` field first, else its first
 * control), Tab stays inside the topmost one, and closing it hands focus back
 * to what had it.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
const DIALOG = '[role="dialog"][aria-modal="true"]'

interface Open {
  el: HTMLElement
  previous: HTMLElement | null
}

const open: Open[] = []

function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement)
}

function adopt(el: HTMLElement): void {
  if (open.some((o) => o.el === el)) return
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  open.push({ el, previous })
  // After it has had its own say: a dialog that focuses its text box on mount
  // has already put focus where it wants it.
  setTimeout(() => {
    if (!el.isConnected || el.contains(document.activeElement)) return
    // Its marked field, else the first place to type - a dialog that asks for
    // something wants it typed, and the close button is not that - else the
    // first control.
    const target =
      el.querySelector<HTMLElement>('[data-autofocus]') ??
      el.querySelector<HTMLElement>('textarea:not([disabled]), input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') ??
      focusables(el)[0]
    if (target) target.focus({ preventScroll: true })
    else {
      el.tabIndex = -1
      el.focus({ preventScroll: true })
    }
  }, 0)
}

function release(): void {
  for (let i = open.length - 1; i >= 0; i--) {
    const gone = open[i]
    if (gone.el.isConnected) continue
    open.splice(i, 1)
    // Only if focus was lost with it: if the person has gone somewhere else
    // since, that is where they are.
    const lost = !document.activeElement || document.activeElement === document.body
    if (!lost) continue
    if (gone.previous?.isConnected) gone.previous.focus({ preventScroll: true })
    // What had it is gone too - a menu entry that opened the dialog is not
    // there to go back to - so the message box, where people are.
    else document.querySelector<HTMLElement>('.composer-input')?.focus({ preventScroll: true })
  }
}

let installed = false

export function installDialogFocus(): void {
  if (installed) return
  installed = true
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return
        if (n.matches(DIALOG)) adopt(n)
        n.querySelectorAll<HTMLElement>(DIALOG).forEach(adopt)
      })
    }
    release()
  }).observe(document.body, { childList: true, subtree: true })

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const top = [...open].reverse().find((o) => o.el.isConnected)
    if (!top) return
    const list = focusables(top.el)
    if (list.length === 0) {
      e.preventDefault()
      return
    }
    const here = list.indexOf(document.activeElement as HTMLElement)
    if (here < 0) {
      e.preventDefault()
      list[e.shiftKey ? list.length - 1 : 0].focus()
    } else if (e.shiftKey && here === 0) {
      e.preventDefault()
      list[list.length - 1].focus()
    } else if (!e.shiftKey && here === list.length - 1) {
      e.preventDefault()
      list[0].focus()
    }
  })
}

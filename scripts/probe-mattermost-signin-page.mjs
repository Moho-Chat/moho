#!/usr/bin/env node
/**
 * The Mattermost sign-in page (the way in for single sign-on) against the local server: the window opens the server's
 * own login page, a password is typed into it there (as a person would, or as an SSO provider would sign them in), and
 * the session the page leaves (MMAUTHTOKEN) becomes the account, which connects. Removing the account ends that
 * session at the server, since moho made it.
 *
 *   npx electron-vite build && node scripts/probe-mattermost-signin-page.mjs
 */
import { execFileSync } from 'node:child_process'
import { launchApp, sleep, cdp } from './lib/harness.mjs'
import { as, SERVER, PASSWORDS } from './lib/mattermost-local.mjs'

const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}
const until = async (fn, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(300)
  }
  return null
}

const { page, stop, port } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
// Never left running: whatever happens, the app is stopped after two minutes.
setTimeout(() => void stop().then(() => process.exit(1)), 120000).unref()
const ev = (code) => page.evaluate(code)
try {
  await sleep(2000)
  const before = (await as('mohob', 'GET', '/users/me/sessions')).length
  await ev(`(window.__signin = window.moho.browserLogin('mattermost', undefined, { server: ${JSON.stringify(SERVER)} }), true)`)
  const target = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    return list.find((t) => t.type === 'page' && t.url.includes('/login'))
  })
  check('the server’s own sign-in page opens', !!target)
  // Out of the way, on the second workspace.
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }))
    for (const c of clients.filter((c) => /Sign in to Mattermost/.test(c.title))) {
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.move({ window = "address:${c.address}", workspace = "2", silent = true })`])
    }
  } catch {
    /* not on Hyprland */
  }
  const login = cdp(target.webSocketDebuggerUrl)
  const typed = await until(
    () =>
      login.evaluate(`(() => {
        // The server's landing page asks first where to view it; a person picks the browser.
        const landing = [...document.querySelectorAll('a, button')].find((b) => /view in browser/i.test(b.textContent))
        if (landing) { landing.click(); return false }
        const pw = document.querySelector('input[type=password]'), id = [...document.querySelectorAll('input')].find((i) => i.type === 'text' || i.type === 'email')
        if (!id || !pw) return false
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(id, 'mohob'); id.dispatchEvent(new Event('input', { bubbles: true }))
        set.call(pw, ${JSON.stringify(PASSWORDS.mohob)}); pw.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => (document.querySelector('button[type=submit]') ?? [...document.querySelectorAll('button')].find((b) => /log in|sign in/i.test(b.textContent)))?.click(), 300)
        return true
      })()`),
    30000
  )
  check('the password is typed into the server’s page', !!typed)
  await ev(`window.__signin.then((r) => { window.__signedIn = JSON.stringify(r) })`).catch(() => {})
  const outcome = await until(() => ev('window.__signedIn'), 30000)
  check('the window says it worked', !!outcome && JSON.parse(outcome).ok, outcome)
  const account = await until(async () => (await ev(`window.moho.rpc('listAccounts')`)).find((a) => a.service === 'mattermost' && a.state === 'connected'), 30000)
  check('the account connects with the page’s session', !!account && account.displayName === 'mohob', JSON.stringify(account))
  const during = (await as('mohob', 'GET', '/users/me/sessions')).length
  check('a session of moho’s own was made', during === before + 1, `${before} -> ${during}`)
  await ev(`window.moho.rpc('removeAccount', { accountId: ${JSON.stringify(account?.id ?? '')} })`)
  const after = await until(async () => (await as('mohob', 'GET', '/users/me/sessions')).length === before, 15000)
  check('removing the account ends that session', !!after)
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  await stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)

#!/usr/bin/env node
/**
 * Pictures of Mattermost in the window, against the local Mattermost server (mohoa signed in): the sign-in form, a team
 * channel under its categories with Markdown, an integration's card and a link preview, the member list, a thread
 * open beside the channel, and a direct message.
 *
 *   npx electron-vite build && node scripts/check-mattermost-ui.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { as, SERVER, PASSWORDS } from './lib/mattermost-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const shot = async (name) => {
  await sleep(1500)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  console.log('  shot', name)
}
const until = async (fn, ms = 30000) => {
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
let ok = true
try {
  // Something to read: B writes in Alpha's Town Square - Markdown, a table, a thread - and an integration's card.
  const me = await as('mohoa', 'GET', '/users/me')
  const bee = await as('mohob', 'GET', '/users/me')
  const alpha = await as('mohob', 'GET', '/teams/name/alpha')
  const square = await as('mohob', 'GET', `/teams/${alpha.id}/channels/name/town-square`)
  const root = await as('mohob', 'POST', '/posts', { channel_id: square.id, message: 'Release checklist for **1.6**, @mohoa:\n\n| Step | Who |\n|---|---|\n| Tag | mohob |\n| Mirror | mohoa |\n\n- [x] changelog\n- [ ] announce :tada:' })
  await as('mohoc', 'POST', '/posts', { channel_id: square.id, root_id: root.id, message: 'I can take the announcement.' })
  await as('mohob', 'POST', '/posts', { channel_id: square.id, root_id: root.id, message: 'Thanks! ~~Friday~~ Thursday then.' })
  await as('mohob', 'POST', '/posts', { channel_id: square.id, message: 'Build finished', props: { attachments: [{ color: '#2eb886', title: 'CI #412 passed', title_link: 'https://ci.example.org/412', text: 'All 2071 tests passed on `protocol/mattermost`.', fields: [{ title: 'Branch', value: 'protocol/mattermost', short: true }, { title: 'Took', value: '4m 12s', short: true }] }] } })
  await as('mohoa', 'PUT', `/users/${me.id}/preferences`, [{ user_id: me.id, category: 'flagged_post', name: root.id, value: 'true' }])
  const dm = await as('mohob', 'POST', '/channels/direct', [bee.id, me.id])
  await as('mohob', 'POST', '/posts', { channel_id: dm.id, message: 'Are you coming to the call later? `npm run deploy` is done :+1:' })

  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  // The form.
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(500)
  await ev(`document.querySelector('[data-add-account]')?.click()`)
  await sleep(500)
  await ev(`[...document.querySelectorAll('.service-tile')].find((x) => x.textContent.includes('Mattermost')).click()`)
  await shot('mattermost-form.png')

  // Signed in.
  const login = await rpc('addMattermostAccount', { server: SERVER, login: 'mohoa', password: PASSWORDS.mohoa })
  const account = await until(async () => (await rpc('listAccounts')).find((a) => a.service === 'mattermost' && a.state === 'connected'))
  ok = !!account && !!login && ok
  await ev(`window.__mohoShots.store.setActivePanel?.('chat')`)
  await ev(`window.__mohoShots?.store.refreshAccounts?.(); window.__mohoShots?.store.refreshBuffers?.()`)
  const town = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account.id && b.remoteId === square.id))
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(town.id)})`)
  await rpc('requestMemberList', { bufferId: town.id })
  await shot('mattermost-channel.png')

  // What the account keeps beside its channels: the threads it follows, its saved posts.
  await ev(`document.querySelector('[title^="Threads, saved posts"]')?.click()`)
  await until(() => ev('!!document.querySelector(".history-row")'), 10000)
  await shot('mattermost-threads.png')
  await ev(`[...document.querySelectorAll('.search-scope button')].find((b) => b.textContent === 'Saved')?.click()`)
  await shot('mattermost-saved.png')
  await ev(`document.querySelector('[title^="Threads, saved posts"]')?.click()`)

  // The thread beside it.
  await ev(`window.__mohoShots.store.openThreadPanel(${JSON.stringify(town.id)}, ${JSON.stringify(root.id)})`)
  await until(() => ev('!!document.querySelector(".thread-pane")'))
  await shot('mattermost-thread.png')
  await ev('window.__mohoShots.store.closeThreadPanel()')

  // A direct message.
  const direct = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account.id && b.remoteId === dm.id))
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(direct.id)})`)
  await shot('mattermost-dm.png')
} catch (e) {
  console.log('stopped:', e.stack)
  ok = false
} finally {
  await stop()
}
console.log(ok ? 'DONE' : 'FAILED')
process.exit(ok ? 0 : 1)

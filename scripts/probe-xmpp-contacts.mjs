#!/usr/bin/env node
/**
 * The contact list to a file and back: one account saves its roster (names and groups kept, in RFC 6121's own XML), another
 * adds what the file holds, and the people on it are asked as adding one by hand asks them; a plain list of addresses too.
 *
 *   node scripts/probe-xmpp-contacts.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-contacts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { start, sleep } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 4 })
const [me, other, a, b] = t.accounts
try {
  for (const p of [me, other, a, b]) await t.signIn(p)
  t.check('they sign in', true)
  await t.rpc('xmppAddContact', { accountId: t.accountId(me), jid: a.jid, name: 'Ada', group: 'Work' })
  await t.rpc('xmppAddContact', { accountId: t.accountId(me), jid: b.jid, name: 'Bea' })
  await sleep(1500)
  const file = path.join(t.scratch, 'roster.xml')
  const out = await t.rpc('xmppExportContacts', { accountId: t.accountId(me), path: file })
  const text = fs.readFileSync(file, 'utf8')
  t.check('the roster is saved, names and groups with it', out.exported === 2 && text.includes(`jid='${a.jid}'`) && /name=['"]Ada['"]/.test(text) && /<group>Work<\/group>/.test(text), text.slice(0, 400))

  const imported = await t.rpc('xmppImportContacts', { accountId: t.accountId(other), path: file, ask: true })
  t.check('another account adds them from the file', imported.added === 2 && imported.failed.length === 0, JSON.stringify(imported))
  const asked = await t.until(async () => (await t.rpc('xmppRequests', { accountId: t.accountId(a) })).requests.some((r) => r.jid === other.jid), 8000)
  t.check('and they are asked, as adding by hand asks', !!asked)
  const again = await t.rpc('xmppImportContacts', { accountId: t.accountId(other), path: file, ask: true })
  t.check('importing the same file again changes nothing', again.added === 0 && again.kept === 2, JSON.stringify(again))

  const list = path.join(t.scratch, 'list.txt')
  fs.writeFileSync(list, `# people\n${me.jid}, The First\nnot an address\n`)
  const fromList = await t.rpc('xmppImportContacts', { accountId: t.accountId(b), path: list, ask: false })
  t.check('a plain list of addresses is read too, and with "ask" off nobody is asked', fromList.added === 1, JSON.stringify(fromList))
  await sleep(1000)
  t.check('(nobody was)', !(await t.rpc('xmppRequests', { accountId: t.accountId(me) })).requests.some((r) => r.jid === b.jid))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}

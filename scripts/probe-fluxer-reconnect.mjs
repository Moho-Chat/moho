#!/usr/bin/env node
/**
 * moho, signed in to the local self-hosted Fluxer as mohoa, while the instance's gateway is restarted under it: it
 * comes back by itself, with no new sign-in (the account's list of sessions is the same length), and hears what is
 * said afterwards.
 *
 *   npx electron-vite build && node scripts/probe-fluxer-reconnect.mjs
 */
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'
import { accounts, as, ORIGIN } from './lib/fluxer-local.mjs'

const acc = accounts()
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const rpc = (method, params = {}) => page.evaluate(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
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
    await sleep(500)
  }
  return null
}
const docker = (...args) => execFileSync('docker', ['compose', ...args], { cwd: '/1tb/fluxer-test/bundle', env: { ...process.env, DOCKER_HOST: 'unix:///run/docker-fluxer.sock' }, stdio: 'pipe' })
try {
  await sleep(2500)
  const account = `fluxer:${acc.mohoa.user_id}`
  await rpc('addFluxerAccountToken', { instance: ORIGIN, token: acc.mohoa.token })
  check('mohoa connects', !!(await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'))))
  const sessions = (await as('mohoa', 'GET', '/auth/sessions')).length
  docker('restart', 'gateway')
  const dropped = await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state !== 'connected'), 30000)
  check('the restart is noticed', !!dropped, dropped?.state)
  const back = await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'), 180000)
  check('and moho is connected again by itself', !!back)
  check('without a new sign-in', (await as('mohoa', 'GET', '/auth/sessions')).length === sessions)
  const hall = (await as('mohob', 'GET', '/users/@me/guilds')).find((g) => g.name === 'Test Hall')
  const channel = (await as('mohob', 'GET', `/guilds/${hall.id}/channels`)).find((c) => c.name === 'general').id
  const general = (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === channel)?.id
  await rpc('getBacklog', { bufferId: general })
  const word = `after the restart ${Date.now().toString(36)}`
  // mohob needs a session of its own to speak; the probe's helper keeps one.
  const { session } = await import('./lib/fluxer-local.mjs')
  const bob = await session('mohob')
  await as('mohob', 'POST', `/channels/${channel}/messages`, { content: word })
  bob.close()
  check('and hears what is said afterwards', !!(await until(async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body === word))))
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  await stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)

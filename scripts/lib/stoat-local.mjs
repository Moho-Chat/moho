/**
 * The local self-hosted Stoat the Stoat probes talk to (http://localhost:8880, started with
 * ~/.local/share/moho-dev/stoat-docker.sh and set up with stoat-local.py): its two test accounts, and calls made as
 * either of them - the "other person" in a conversation moho is one side of.
 */
import fs from 'node:fs'

export const API = 'http://localhost:8880/api'
export const accounts = () => JSON.parse(fs.readFileSync('/1tb/stoat-test/accounts.json', 'utf8'))

/** One call as `who` ('alice' or 'bob'). */
export async function as(who, method, path, body) {
  return withToken(accounts()[who].token, method, path, body)
}

/** A call with a token, waiting out the instance's rate limit as a client has to (a 429 says how long). */
async function withToken(token, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + path, {
      method,
      headers: { 'X-Session-Token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    const text = await r.text()
    if (r.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, (JSON.parse(text).retry_after ?? 1000) + 50))
      continue
    }
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
}

/** A file put on the file server as `who`, answering its id. `tag` is attachments, emojis, avatars, icons... */
export async function upload(who, name, bytes, type, tag = 'attachments') {
  const a = accounts()[who]
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  const r = await fetch(`http://localhost:8880/autumn/${tag}`, { method: 'POST', headers: { 'X-Session-Token': a.token }, body: form })
  if (!r.ok) throw new Error(`upload: ${r.status} ${await r.text()}`)
  return (await r.json()).id
}

/** A new account made on the local instance (never the official one): answers its token and id, for a probe that needs a stranger. */
export async function makeAccount(name) {
  const email = `${name}@test.local`
  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const post = async (path, body, token) => {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) }, body: JSON.stringify(body) })
    const text = await r.text()
    if (!r.ok) throw new Error(`POST ${path}: ${r.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  await post('/auth/account/create', { email, password })
  const session = await post('/auth/session/login', { email, password, friendly_name: 'probe' })
  await post('/onboard/complete', { username: name }, session.token)
  const me = await (await fetch(API + '/users/@me', { headers: { 'X-Session-Token': session.token } })).json()
  const call = (method, path, body) => withToken(session.token, method, path, body)
  return { id: me._id, username: me.username, token: session.token, call }
}

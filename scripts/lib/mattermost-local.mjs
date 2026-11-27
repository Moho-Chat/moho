/**
 * The local Mattermost server the Mattermost probes talk to (http://127.0.0.1:8065: the `mattermost/mattermost-preview`
 * image on its own dockerd, ~/.local/share/moho-dev/mattermost-docker.sh, set up with mm-local.py there): its test
 * users, and calls made as one of them.
 */
export const SERVER = process.env.MM_SERVER ?? 'http://127.0.0.1:8065'
export const PASSWORDS = { mmadmin: 'Admin-pass-123', mohoa: 'Pass-mohoa-123', mohob: 'Pass-mohob-123', mohoc: 'Pass-mohoc-123' }

const tokens = {}

/** A session for a test user, made once per run. */
export async function token(who) {
  if (tokens[who]) return tokens[who]
  const r = await fetch(`${SERVER}/api/v4/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: who, password: PASSWORDS[who] }) })
  if (!r.ok) throw new Error(`login ${who}: ${r.status} ${await r.text()}`)
  tokens[who] = r.headers.get('token')
  return tokens[who]
}

/** One call as `who`. */
export async function as(who, method, route, body) {
  const r = await fetch(`${SERVER}/api/v4${route}`, {
    method,
    headers: { Authorization: `Bearer ${await token(who)}`, 'X-Requested-With': 'XMLHttpRequest', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

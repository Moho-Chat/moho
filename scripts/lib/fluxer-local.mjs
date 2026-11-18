/**
 * The local self-hosted Fluxer the Fluxer probes talk to (http://localhost:8890, started with
 * ~/.local/share/moho-dev/fluxer-docker.sh and the compose bundle in /1tb/fluxer-test/bundle; test accounts made with
 * ~/.local/share/moho-dev/fluxer-local.py): its test accounts, calls made as one of them, and a gateway session for the
 * "other person" - Fluxer will not take a message from an account that has never opened one.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ORIGIN = 'http://localhost:8890'
export const API = `${ORIGIN}/api/v1`
export const accounts = () => JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/moho-dev/fluxer-local-accounts.json'), 'utf8'))

/** One call as `who`, waiting out a 429 as a client must (`retry_after` is in seconds). */
export async function as(who, method, route, body) {
  const token = accounts()[who].token
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + route, {
      method,
      headers: { Authorization: token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    const text = await r.text()
    if (r.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, (JSON.parse(text).retry_after ?? 1) * 1000 + 50))
      continue
    }
    if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
}

/** A file sent as `who` in a message, as multipart. */
export async function sendFile(who, channel, content, name, bytes, type) {
  const form = new FormData()
  form.append('payload_json', JSON.stringify({ content, attachments: [{ id: 0, filename: name }] }))
  form.append('files[0]', new Blob([bytes], { type }), name)
  const r = await fetch(`${API}/channels/${channel}/messages`, { method: 'POST', headers: { Authorization: accounts()[who].token }, body: form })
  if (!r.ok) throw new Error(`file: ${r.status} ${await r.text()}`)
  return r.json()
}

/** A gateway session for `who`, kept up until `close()`: identified, heartbeaten, and listening. */
export async function session(who) {
  const ws = new WebSocket('ws://localhost:8890/gateway?v=1&encoding=json')
  const events = []
  let timer = null
  let seq = null
  const ready = new Promise((resolve, reject) => {
    ws.onmessage = (m) => {
      const p = JSON.parse(m.data)
      if (p.s != null) seq = p.s
      if (p.op === 10) {
        timer = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), p.d.heartbeat_interval * 0.9)
        ws.send(JSON.stringify({ op: 2, d: { token: accounts()[who].token, properties: { os: 'Linux', browser: 'moho-probe', device: 'probe' } } }))
      } else if (p.op === 0) {
        events.push(p)
        if (p.t === 'READY') resolve()
      }
    }
    ws.onerror = reject
  })
  await ready
  return {
    events,
    close: () => {
      clearInterval(timer)
      ws.close(4000)
    }
  }
}

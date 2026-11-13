#!/usr/bin/env node
/**
 * A voice message on XMPP: recorded by the daemon (the window's recorder calls these same three methods), sent as an Ogg Opus
 * file over HTTP Upload that says how long it is (XEP-0447 with XEP-0446 `length`) - how XMPP clients send them - and shown
 * here as a voice message. Another client (slixmpp) checks what arrives, and the file is fetched back.
 *
 *   node scripts/probe-xmpp-voice.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-voice.mjs
 *
 * The microphone is not this machine's: the scratch daemon has an ALSA configuration of its own (its HOME's .asoundrc) whose
 * default capture device reads a recording of speech from a file (~/.local/share/moho-dev/speech-48k-mono.raw, raw S16_LE
 * 48 kHz mono). Nothing on the machine's audio is touched.
 */
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { start, sleep, ca } from './lib/xmpp-daemon.mjs'

const speech = path.join(os.homedir(), '.local/share/moho-dev/speech-48k-mono.raw')
const asoundrc = `pcm.!default {
  type asym
  playback.pcm "null"
  capture.pcm {
    type plug
    slave { pcm { type file slave.pcm "null" file "/dev/null" infile "${speech}" format "raw" } format S16_LE rate 48000 channels 1 }
  }
}
`
const t = await start({ people: 2, home: { '.asoundrc': asoundrc } })
const [me, you] = t.accounts
const myId = t.accountId(me)
const fetch = (url) =>
  new Promise((resolve, reject) => https.get(url, { ca }, (r) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => resolve(Buffer.concat(chunks))) }).on('error', reject))
try {
  t.check('it signs in', !!(await t.signIn(me)))
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='v-0'><body>say something</body></message>` }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  await t.rpc('subscribe', { bufferId: b.id })

  await t.rpc('startVoiceMessage', { bufferId: b.id })
  await sleep(3000)
  const progress = await t.rpc('voiceMessageProgress')
  t.check('it records, and hears something', progress.recording && progress.seconds >= 2, JSON.stringify(progress))
  const sent = await t.rpc('sendVoiceMessage')
  t.check('and sends it', sent.durationSecs >= 2, JSON.stringify(sent))

  const own = await t.until(async () => t.seen('message', (d) => d.bufferId === b.id && d.isOwn && d.attachments?.length))
  const a = own?.attachments?.[0]
  t.check('shown here as a voice message with its length', a?.voice === true && a?.durationSecs >= 2 && a?.mimetype === 'audio/ogg', JSON.stringify(a))
  const out = await t.peer(you, [{ wait_for: 'file-sharing', timeout: 10 }, { sleep: 0.5 }])
  const msg = out.received.slice(out.received.lastIndexOf('<message', out.received.indexOf('file-sharing')))
  t.check('the other client gets an audio file that says how long it is', /<media-type>audio\/ogg<\/media-type>/.test(msg) && /<length>\d{4,}<\/length>/.test(msg), msg.slice(0, 600))
  const url = /<url>(https:[^<]+)<\/url>/.exec(msg)?.[1]
  const bytes = url ? await fetch(url) : Buffer.alloc(0)
  t.check('and the file is an Ogg Opus recording', bytes.subarray(0, 4).toString() === 'OggS' && bytes.includes(Buffer.from('OpusHead')), `${url} ${bytes.length} bytes`)
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}

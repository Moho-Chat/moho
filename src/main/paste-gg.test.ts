import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LogUploadStore,
  checkPasteGg,
  deleteFromPasteGg,
  uploadToPasteGg,
  type PasteGgFetch
} from './paste-gg'

describe('paste.gg client', () => {
  it('uploads an anonymous unlisted 7-day paste and returns its URL and deletion key', async () => {
    let captured: { url: string; method?: string; headers?: Record<string, string>; body?: string } | null = null
    const mockFetch: PasteGgFetch = async (url, init) => {
      captured = { url, ...init }
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            status: 'success',
            result: {
              id: 'c870f9abcdef',
              deletion_key: 'del-secret-key',
              expires: '2026-12-04T04:00:00.000Z'
            }
          })
      }
    }

    const now = new Date('2026-11-27T04:00:00.000Z')
    const res = await uploadToPasteGg('log text', mockFetch, now)
    expect(res.id).toBe('c870f9abcdef')
    expect(res.url).toBe('https://paste.gg/p/anonymous/c870f9abcdef')
    expect(res.deletionKey).toBe('del-secret-key')
    expect(res.expiresAt).toBe('2026-12-04T04:00:00.000Z')

    expect(captured!.url).toBe('https://api.paste.gg/v1/pastes')
    expect(captured!.method).toBe('POST')
    expect(captured!.headers?.Authorization).toBeUndefined()
    const body = JSON.parse(captured!.body!)
    expect(body.visibility).toBe('unlisted')
    expect(body.expires).toBe('2026-12-04T04:00:00.000Z')
    expect(body.files[0].name).toBe('moho-logs.txt')
    expect(body.files[0].content.value).toBe('log text')
  })

  it('interprets 200 as active, 404 as expired, and errors as unknown', async () => {
    expect(
      await checkPasteGg('abc', async () => ({ ok: true, status: 200, text: async () => '{}' }))
    ).toBe('active')
    expect(
      await checkPasteGg('abc', async () => ({
        ok: false,
        status: 404,
        text: async () => '{"status":"error","error":"missing_paste"}'
      }))
    ).toBe('expired')
    expect(
      await checkPasteGg('abc', async () => {
        throw new Error('offline')
      })
    ).toBe('unknown')
  })

  it('sends Authorization: Key <deletion_key> on DELETE and treats 204 or 404 as ok', async () => {
    let authHeader = ''
    const ok204 = await deleteFromPasteGg('abc', 'k123', async (_url, init) => {
      authHeader = init?.headers?.Authorization ?? ''
      return { ok: true, status: 204, text: async () => '' }
    })
    expect(authHeader).toBe('Key k123')
    expect(ok204.ok).toBe(true)

    const ok404 = await deleteFromPasteGg('abc', 'k123', async () => ({
      ok: false,
      status: 404,
      text: async () => '{"error":"missing_paste"}'
    }))
    expect(ok404.ok).toBe(true)

    const err403 = await deleteFromPasteGg('abc', 'wrong', async () => ({
      ok: false,
      status: 403,
      text: async () => '{"error":"not_allowed"}'
    }))
    expect(err403.ok).toBe(false)
    expect(err403.error).toBe('not_allowed')
  })
})

describe('LogUploadStore', () => {
  it('persists records, strips deletionKey from publicList, marks expired and forgets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-uploads-'))
    const file = path.join(dir, 'log-uploads.json')
    try {
      const store = new LogUploadStore(file)
      store.add({
        id: 'p1',
        url: 'https://paste.gg/p/anonymous/p1',
        deletionKey: 'secret1',
        createdAt: '2026-11-27T04:00:00.000Z',
        expiresAt: '2026-12-04T04:00:00.000Z',
        sizeBytes: 42000,
        linesOmitted: 0,
        status: 'active'
      })

      const pub = store.publicList()
      expect(pub).toHaveLength(1)
      expect('deletionKey' in pub[0]).toBe(false)
      expect(store.get('p1')?.deletionKey).toBe('secret1')

      // Reload from disk.
      const reloaded = new LogUploadStore(file)
      expect(reloaded.get('p1')?.deletionKey).toBe('secret1')

      reloaded.markExpired('p1', 'expired', '2026-12-04T04:01:00.000Z')
      expect(reloaded.publicList()[0].status).toBe('expired')
      expect(reloaded.publicList()[0].goneReason).toBe('expired')

      reloaded.forget('p1')
      expect(reloaded.publicList()).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

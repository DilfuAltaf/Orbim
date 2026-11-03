import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it } from 'node:test'

import spotifyHealthHandler from '../api/spotify/health.ts'
import spotifySearchHandler from '../api/spotify/search.ts'
import spotifyLyricsHandler from '../api/spotify/lyrics.ts'
import audioUploadHandler from '../api/audio/upload.ts'
import audioRegistryHandler from '../api/audio/registry.ts'
import audioStreamHandler from '../api/audio/stream.ts'
import usersHandler from '../api/users/index.ts'
import invitationsHandler from '../api/invitations/index.ts'
import invitationPreviewHandler from '../api/invitations/preview.ts'
import invitationRespondHandler from '../api/invitations/respond.ts'
import invitationAcceptHandler from '../api/invitations/accept.ts'
import playlistsHandler from '../api/playlists/index.ts'
import playlistTracksHandler from '../api/playlists/tracks.ts'
import playlistCollaboratorsHandler from '../api/playlists/collaborators.ts'
import notificationsHandler from '../api/notifications/index.ts'
import { _resetServerTokenCacheForTesting } from '../src/server/spotify-service.ts'

interface MockResponseCapture {
  res: ServerResponse
  getStatusCode(): number
  getHeaders(): Record<string, string | number>
  getBody(): string
  getJson<T>(): T
}

function createMockReq(options: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: unknown
}): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage
  req.method = options.method || 'GET'
  req.url = options.url || '/'
  req.headers = options.headers || {}

  ;(req as unknown as { body: unknown }).body =
    options.body !== undefined ? options.body : Buffer.from([])
  return req
}

function createMockRes(): MockResponseCapture {
  let statusCode = 200
  const headers: Record<string, string | number> = {}
  let body = ''

  const res = {
    writeHead(code: number, hdrs?: Record<string, string | number>) {
      statusCode = code
      if (hdrs) Object.assign(headers, hdrs)
      return res
    },
    setHeader(name: string, value: string | number) {
      headers[name] = value
      return res
    },
    write(chunk: unknown) {
      body += String(chunk)
      return true
    },
    end(chunk?: unknown) {
      if (chunk) body += String(chunk)
      return res
    },
  } as unknown as ServerResponse

  return {
    res,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => body,
    getJson: <T>() => JSON.parse(body) as T,
  }
}

describe('Vercel Serverless Function Endpoints Suite', () => {
  describe('1. GET /api/spotify/health', () => {
    it('returns health and configuration status', () => {
      const req = createMockReq({ method: 'GET', url: '/api/spotify/health' })
      const res = createMockRes()

      spotifyHealthHandler(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ ok: boolean; configured: boolean }>()
      assert.equal(data.ok, true)
      assert.equal(typeof data.configured, 'boolean')
    })
  })

  describe('2. GET /api/spotify/search', () => {
    it('returns empty tracks array when query is empty', async () => {
      const req = createMockReq({ method: 'GET', url: '/api/spotify/search?q=' })
      const res = createMockRes()

      await spotifySearchHandler(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ tracks: unknown[] }>()
      assert.deepEqual(data.tracks, [])
    })

    it('clamps limit to maximum 10 and parses offset correctly', async () => {
      _resetServerTokenCacheForTesting()
      const req = createMockReq({ method: 'GET', url: '/api/spotify/search?q=the%20cure&limit=50&offset=10' })
      const res = createMockRes()

      await spotifySearchHandler(req, res.res)

      // Will either succeed if credentials are valid, or return a formatted 500 error without crash
      assert.ok(res.getStatusCode() === 200 || res.getStatusCode() === 500 || res.getStatusCode() === 429)
      const data = res.getJson<{ tracks?: unknown[]; error?: string }>()
      if (res.getStatusCode() === 200) {
        assert.ok(Array.isArray(data.tracks))
        assert.ok((data.tracks?.length || 0) <= 10, 'Must never exceed limit 10')
      } else {
        assert.ok(data.error)
      }
    })
  })

  describe('3. GET /api/spotify/lyrics', () => {
    it('returns 400 when title or artist parameter is missing', async () => {
      const req = createMockReq({ method: 'GET', url: '/api/spotify/lyrics?title=Hello' })
      const res = createMockRes()

      await spotifyLyricsHandler(req, res.res)

      assert.equal(res.getStatusCode(), 400)
      const data = res.getJson<{ error: string }>()
      assert.match(data.error, /missing/i)
    })

    it('fetches or gracefully returns 404 for unknown track', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/spotify/lyrics?title=NonExistentSongXYZ12345&artist=NonExistentArtistXYZ12345',
      })
      const res = createMockRes()

      await spotifyLyricsHandler(req, res.res)

      assert.ok(res.getStatusCode() === 404 || res.getStatusCode() === 200)
    })
  })

  describe('4. POST /api/audio/upload', () => {
    it('rejects non-POST methods with 405', async () => {
      const req = createMockReq({ method: 'GET', url: '/api/audio/upload' })
      const res = createMockRes()

      await audioUploadHandler(req, res.res)

      assert.equal(res.getStatusCode(), 405)
    })

    it('rejects empty file buffer payload with 400', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/api/audio/upload',
        headers: {
          'content-type': 'application/octet-stream',
          'x-provider-track-id': 'test-track-empty',
        },
        body: Buffer.from([]),
      })
      const res = createMockRes()

      await audioUploadHandler(req, res.res)

      assert.equal(res.getStatusCode(), 400)
      assert.match(res.getJson<{ error: string }>().error, /empty file/i)
    })

    it('processes audio upload and returns storagePath and audioUrl', async () => {
      const mockAudio = Buffer.from('FAKE-AUDIO-DATA-12345678')
      const req = createMockReq({
        method: 'POST',
        url: '/api/audio/upload',
        headers: {
          'content-type': 'application/octet-stream',
          'x-provider-track-id': 'spotify:track:test_audio_upload_01',
          'x-file-name': encodeURIComponent('song.mp3'),
          'x-title': encodeURIComponent('Test Track Title'),
          'x-artist': encodeURIComponent('Test Artist Name'),
        },
        body: mockAudio,
      })
      const res = createMockRes()

      await audioUploadHandler(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ success: boolean; audioUrl: string; storagePath: string }>()
      assert.equal(data.success, true)
      assert.ok(data.audioUrl)
      assert.ok(data.storagePath.startsWith('global/'))
      assert.ok(data.storagePath.endsWith('.mp3'))
    })
  })

  describe('5. /api/audio/registry', () => {
    const testTrackId = 'spotify:track:test_registry_track_1'

    it('saves a record via POST and deletes it via DELETE', async () => {
      // 1. POST record
      const postReq = createMockReq({
        method: 'POST',
        url: '/api/audio/registry',
        headers: { 'content-type': 'application/json' },
        body: {
          providerTrackId: testTrackId,
          audioUrl: 'https://cdn.orbim.app/audio/test.mp3',
          title: 'Registry Track',
          artistName: 'Registry Artist',
        },
      })
      const postRes = createMockRes()
      await audioRegistryHandler(postReq, postRes.res)
      assert.equal(postRes.getStatusCode(), 200)
      assert.equal(postRes.getJson<{ success: boolean }>().success, true)

      // 2. GET registry
      const getReq = createMockReq({ method: 'GET', url: '/api/audio/registry' })
      const getRes = createMockRes()
      await audioRegistryHandler(getReq, getRes.res)
      assert.equal(getRes.getStatusCode(), 200)
      const getData = getRes.getJson<{ success: boolean; records: Record<string, unknown> }>()
      assert.equal(getData.success, true)
      assert.ok(getData.records)

      // 3. DELETE record
      const delReq = createMockReq({
        method: 'DELETE',
        url: `/api/audio/registry?providerTrackId=${encodeURIComponent(testTrackId)}`,
      })
      const delRes = createMockRes()
      await audioRegistryHandler(delReq, delRes.res)
      assert.equal(delRes.getStatusCode(), 200)
      assert.equal(delRes.getJson<{ success: boolean; deleted: boolean }>().deleted, true)
    })
  })

  describe('6. /api/users', () => {
    it('searches users directory and omits sensitive user emails', async () => {
      const req = createMockReq({ method: 'GET', url: '/api/users?q=dilfu' })
      const res = createMockRes()

      await usersHandler(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ success: boolean; users: Array<Record<string, unknown>> }>()
      assert.equal(data.success, true)
      assert.ok(Array.isArray(data.users))
      for (const u of data.users) {
        assert.equal(u.email, undefined, 'Must NEVER return account emails in public collaborator directory')
        assert.ok(u.id)
        assert.ok(u.displayName)
      }
    })
  })

  describe('7. /api/invitations and collaboration lifecycle', () => {
    const testPlaylistId = `test-pl-${Date.now()}`
    const testOwnerId = `usr-test-owner-${Date.now()}`
    const testInviteeId = `usr-test-invitee-${Date.now()}`

    it('creates an invitation, previews it, and accepts it', async () => {
      // 0. Seed a test playlist
      const createPlReq = createMockReq({
        method: 'POST',
        url: '/api/playlists',
        headers: { 'content-type': 'application/json' },
        body: {
          id: testPlaylistId,
          title: 'Collaborative Party',
          owner_id: testOwnerId,
          visibility: 'shared',
        },
      })
      const createPlRes = createMockRes()
      await playlistsHandler(createPlReq, createPlRes.res)
      assert.equal(createPlRes.getStatusCode(), 200)

      // 1. Create an invitation
      const rawToken = 'test-token-64-character-secret-abcd-1234-5678-9012-3456-7890'
      const invReq = createMockReq({
        method: 'POST',
        url: '/api/invitations',
        headers: { 'content-type': 'application/json' },
        body: {
          playlistId: testPlaylistId,
          createdBy: testOwnerId,
          inviteeId: testInviteeId,
          inviteeDisplayName: 'Invited Friend',
          rawToken,
          role: 'editor',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          playlistTitle: 'Collaborative Party',
        },
      })
      const invRes = createMockRes()
      await invitationsHandler(invReq, invRes.res)
      assert.equal(invRes.getStatusCode(), 200)
      const invData = invRes.getJson<{ success: boolean; invitationId?: string }>()
      assert.equal(invData.success, true)

      // 2. Preview the invitation using token
      const previewReq = createMockReq({
        method: 'GET',
        url: `/api/invitations/preview?token=${encodeURIComponent(rawToken)}`,
      })
      const previewRes = createMockRes()
      await invitationPreviewHandler(previewReq, previewRes.res)
      assert.equal(previewRes.getStatusCode(), 200)
      const previewData = previewRes.getJson<{ success: boolean; invitation?: { playlistTitle?: string } }>()
      assert.equal(previewData.success, true)
      assert.equal(previewData.invitation?.playlistTitle, 'Collaborative Party')

      // 3. Accept the invitation
      const acceptReq = createMockReq({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { 'content-type': 'application/json' },
        body: {
          token: rawToken,
          userId: testInviteeId,
          displayName: 'Invited Friend',
        },
      })
      const acceptRes = createMockRes()
      await invitationAcceptHandler(acceptReq, acceptRes.res)
      assert.equal(acceptRes.getStatusCode(), 200)
      const acceptData = acceptRes.getJson<{ success: boolean; status?: string }>()
      assert.equal(acceptData.success, true)
    })

    it('responds to invitation by declining it', async () => {
      // Create invitation for respond test
      const invReq = createMockReq({
        method: 'POST',
        url: '/api/invitations',
        headers: { 'content-type': 'application/json' },
        body: {
          playlistId: testPlaylistId,
          createdBy: testOwnerId,
          inviteeId: 'user-decline-target',
          rawToken: 'decline-test-token-1234567890-unique',
          role: 'editor',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      })
      const invRes = createMockRes()
      await invitationsHandler(invReq, invRes.res)
      assert.equal(invRes.getStatusCode(), 200)
      const createdId = invRes.getJson<{ invitationId?: string }>().invitationId!

      // Respond with decline
      const respReq = createMockReq({
        method: 'POST',
        url: '/api/invitations/respond',
        headers: { 'content-type': 'application/json' },
        body: {
          invitationId: createdId,
          userId: 'user-decline-target',
          action: 'decline',
        },
      })
      const respRes = createMockRes()
      await invitationRespondHandler(respReq, respRes.res)
      assert.equal(respRes.getStatusCode(), 200)
      assert.equal(respRes.getJson<{ success: boolean }>().success, true)
    })
  })

  describe('8. /api/playlists and collaborators', () => {
    const plId = `pl-suite-${Date.now()}`

    it('creates, reads, adds collaborator, and deletes a playlist', async () => {
      // 1. Create playlist
      const createReq = createMockReq({
        method: 'POST',
        url: '/api/playlists',
        headers: { 'content-type': 'application/json' },
        body: {
          id: plId,
          title: 'Suite Playlist',
          owner_id: 'test-user-owner',
          visibility: 'private',
        },
      })
      const createRes = createMockRes()
      await playlistsHandler(createReq, createRes.res)
      assert.equal(createRes.getStatusCode(), 200)

      // 2. Add track to playlist
      const trackReq = createMockReq({
        method: 'POST',
        url: '/api/playlists/tracks',
        headers: { 'content-type': 'application/json' },
        body: {
          track: {
            id: `tr-${Date.now()}`,
            playlist_id: plId,
            provider: 'spotify',
            provider_track_id: 'test-track-tr-1',
            title: 'Suite Song',
            artist_name: 'Suite Artist',
            duration_seconds: 180,
            position: 1,
            added_by: 'test-user-owner',
            created_at: new Date().toISOString(),
          },
        },
      })
      const trackRes = createMockRes()
      await playlistTracksHandler(trackReq, trackRes.res)
      assert.equal(trackRes.getStatusCode(), 200)

      // 3. Add collaborator
      const colReq = createMockReq({
        method: 'POST',
        url: '/api/playlists/collaborators',
        headers: { 'content-type': 'application/json' },
        body: {
          playlistId: plId,
          userId: 'user-collab-1',
          displayName: 'Collab User',
          role: 'editor',
        },
      })
      const colRes = createMockRes()
      await playlistCollaboratorsHandler(colReq, colRes.res)
      assert.equal(colRes.getStatusCode(), 200)

      // 4. Read full playlist
      const readReq = createMockReq({
        method: 'GET',
        url: `/api/playlists?playlistId=${encodeURIComponent(plId)}`,
      })
      const readRes = createMockRes()
      await playlistsHandler(readReq, readRes.res)
      assert.equal(readRes.getStatusCode(), 200)
      const fullData = readRes.getJson<{ success: boolean; data: { playlist: { id: string } } }>()
      assert.equal(fullData.success, true)
      assert.equal(fullData.data.playlist.id, plId)

      // 5. Delete playlist
      const delReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists?playlistId=${encodeURIComponent(plId)}`,
      })
      const delRes = createMockRes()
      await playlistsHandler(delReq, delRes.res)
      assert.equal(delRes.getStatusCode(), 200)
      assert.equal(delRes.getJson<{ success: boolean; deleted: boolean }>().deleted, true)
    })
  })

  describe('9. /api/notifications', () => {
    it('creates, queries, patches status, and deletes notification', async () => {
      const notifId = `notif-test-${Date.now()}`
      const targetUser = `user-notif-target-${Date.now()}`

      // 1. POST
      const postReq = createMockReq({
        method: 'POST',
        url: '/api/notifications',
        headers: { 'content-type': 'application/json' },
        body: {
          id: notifId,
          type: 'playlist_invitation',
          recipientUserId: targetUser,
          senderUserId: 'sender-user',
          senderDisplayName: 'Sender Name',
          playlistId: 'pl-1',
          playlistTitle: 'Playlist Title',
          role: 'editor',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      })
      const postRes = createMockRes()
      await notificationsHandler(postReq, postRes.res)
      assert.equal(postRes.getStatusCode(), 200)

      // 2. GET
      const getReq = createMockReq({
        method: 'GET',
        url: `/api/notifications?userId=${encodeURIComponent(targetUser)}`,
      })
      const getRes = createMockRes()
      await notificationsHandler(getReq, getRes.res)
      assert.equal(getRes.getStatusCode(), 200)
      const notifs = getRes.getJson<{ success: boolean; notifications: Array<{ id: string }> }>().notifications
      assert.ok(notifs.some((n) => n.id === notifId))

      // 3. PATCH
      const patchReq = createMockReq({
        method: 'PATCH',
        url: '/api/notifications',
        headers: { 'content-type': 'application/json' },
        body: {
          id: notifId,
          status: 'accepted',
        },
      })
      const patchRes = createMockRes()
      await notificationsHandler(patchReq, patchRes.res)
      assert.equal(patchRes.getStatusCode(), 200)

      // 4. DELETE
      const delReq = createMockReq({
        method: 'DELETE',
        url: `/api/notifications?id=${encodeURIComponent(notifId)}`,
      })
      const delRes = createMockRes()
      await notificationsHandler(delReq, delRes.res)
      assert.equal(delRes.getStatusCode(), 200)
      assert.equal(delRes.getJson<{ success: boolean; deleted: boolean }>().deleted, true)
    })
  })

  describe('10. /api/audio/stream', () => {
    it('blocks directory traversal with 403 Forbidden', () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/audio/stream?path=../../package.json',
      })
      const res = createMockRes()

      audioStreamHandler(req, res.res)

      assert.equal(res.getStatusCode(), 403)
      assert.equal(res.getBody(), 'Forbidden')
    })

    it('redirects global audio track paths to Supabase Storage CDN URL with HTTP 307', () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/audio/stream?path=global/test-audio-uuid.mp3',
      })
      const res = createMockRes()

      audioStreamHandler(req, res.res)

      assert.equal(res.getStatusCode(), 307)
      const location = res.getHeaders()['Location']
      assert.ok(typeof location === 'string')
      assert.ok(location.includes('supabase.co/storage/v1/object/public/track-audio/global/test-audio-uuid.mp3'))
    })
  })
})

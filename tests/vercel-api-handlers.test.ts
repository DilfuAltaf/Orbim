import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it } from 'node:test'

import {
  spotifyHealthHandler,
  spotifyLyricsHandler,
  spotifySearchHandler,
} from '../src/server/api-handlers/spotify-handlers.ts'
import {
  audioRegistryHandler,
  audioStreamHandler,
  audioUploadHandler,
} from '../src/server/api-handlers/audio-handlers.ts'
import usersHandler from '../api/users/index.ts'
import {
  invitationAcceptHandler,
  invitationIndexHandler as invitationsHandler,
  invitationPreviewHandler,
  invitationRespondHandler,
} from '../src/server/api-handlers/invitation-handlers.ts'
import {
  playlistCollaboratorsHandler,
  playlistTracksHandler,
  playlistsIndexHandler as playlistsHandler,
} from '../src/server/api-handlers/playlist-handlers.ts'
import audioDispatcher from '../api/audio/[route].ts'
import spotifyDispatcher from '../api/spotify/[route].ts'
import invitationsDispatcher from '../api/invitations/[route].ts'
import playlistsDispatcher from '../api/playlists/[route].ts'
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

    it('saves a record via POST and retrieves via GET', async () => {
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
      assert.ok(getData.records[testTrackId])
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

      // Cleanup seeded test playlist and associated records
      const delReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists?playlistId=${encodeURIComponent(testPlaylistId)}`,
        headers: { authorization: `Bearer orbim-local-access-token-${testOwnerId}` },
      })
      const delRes = createMockRes()
      await playlistsHandler(delReq, delRes.res)
      assert.equal(delRes.getStatusCode(), 200)
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
        headers: { authorization: 'Bearer orbim-local-access-token-test-user-owner' },
      })
      const delRes = createMockRes()
      await playlistsHandler(delReq, delRes.res)
      assert.equal(delRes.getStatusCode(), 200)
      assert.equal(delRes.getJson<{ success: boolean; deleted: boolean }>().deleted, true)
    })

    it('handles DELETE /api/playlists/tracks with validation, authentication, and authorization', async () => {
      const testPlId = `pl-del-tracks-${Date.now()}`
      const track1Owner = `tr-del-1-${Date.now()}`
      const track2Collab = `tr-del-2-${Date.now()}`
      const track3Admin = `tr-del-3-${Date.now()}`
      const ownerId = 'owner-del-test'
      const collabId = 'collab-del-test'
      const viewerId = 'viewer-del-test'
      const intruderId = 'intruder-del-test'
      const adminId = 'usr-admin-dilfu' // email: dilfualtaf07@gmail.com

      // 1. Create test playlist
      const createReq = createMockReq({
        method: 'POST',
        url: '/api/playlists',
        headers: { 'content-type': 'application/json' },
        body: {
          id: testPlId,
          title: 'Track Deletion Playlist',
          owner_id: ownerId,
          visibility: 'private',
        },
      })
      const createRes = createMockRes()
      await playlistsHandler(createReq, createRes.res)
      assert.equal(createRes.getStatusCode(), 200)

      // 2. Add editor collaborator
      const colReq = createMockReq({
        method: 'POST',
        url: '/api/playlists/collaborators',
        headers: { 'content-type': 'application/json' },
        body: {
          playlistId: testPlId,
          userId: collabId,
          displayName: 'Collab Editor',
          role: 'editor',
        },
      })
      const colRes = createMockRes()
      await playlistCollaboratorsHandler(colReq, colRes.res)
      assert.equal(colRes.getStatusCode(), 200)

      // 2b. Add viewer collaborator
      const viewerReq = createMockReq({
        method: 'POST',
        url: '/api/playlists/collaborators',
        headers: { 'content-type': 'application/json' },
        body: {
          playlistId: testPlId,
          userId: viewerId,
          displayName: 'Collab Viewer',
          role: 'viewer',
        },
      })
      const viewerRes = createMockRes()
      await playlistCollaboratorsHandler(viewerReq, viewerRes.res)
      assert.equal(viewerRes.getStatusCode(), 200)

      // 3. Add tracks:
      // Track 1 added by owner
      const track1Req = createMockReq({
        method: 'POST',
        url: '/api/playlists/tracks',
        headers: { 'content-type': 'application/json' },
        body: {
          track: {
            id: track1Owner,
            playlist_id: testPlId,
            provider: 'spotify',
            provider_track_id: 'test-del-track-1',
            title: 'Owner Track',
            artist_name: 'Removal Artist',
            duration_seconds: 120,
            position: 1,
            added_by: ownerId,
            created_at: new Date().toISOString(),
          },
        },
      })
      const track1Res = createMockRes()
      await playlistTracksHandler(track1Req, track1Res.res)
      assert.equal(track1Res.getStatusCode(), 200)

      // Track 2 added by collab (editor)
      const track2Req = createMockReq({
        method: 'POST',
        url: '/api/playlists/tracks',
        headers: { 'content-type': 'application/json' },
        body: {
          track: {
            id: track2Collab,
            playlist_id: testPlId,
            provider: 'spotify',
            provider_track_id: 'test-del-track-2',
            title: 'Collab Track',
            artist_name: 'Collab Artist',
            duration_seconds: 150,
            position: 2,
            added_by: collabId,
            created_at: new Date().toISOString(),
          },
        },
      })
      const track2Res = createMockRes()
      await playlistTracksHandler(track2Req, track2Res.res)
      assert.equal(track2Res.getStatusCode(), 200)

      // Track 3 added by owner (for admin test)
      const track3Req = createMockReq({
        method: 'POST',
        url: '/api/playlists/tracks',
        headers: { 'content-type': 'application/json' },
        body: {
          track: {
            id: track3Admin,
            playlist_id: testPlId,
            provider: 'spotify',
            provider_track_id: 'test-del-track-3',
            title: 'Track For Admin',
            artist_name: 'Admin Target Artist',
            duration_seconds: 200,
            position: 3,
            added_by: ownerId,
            created_at: new Date().toISOString(),
          },
        },
      })
      const track3Res = createMockRes()
      await playlistTracksHandler(track3Req, track3Res.res)
      assert.equal(track3Res.getStatusCode(), 200)

      // --- Security Phase 1 Tests ---

      // Test A: Missing playlistId or trackId (400)
      const missingParamReq = createMockReq({
        method: 'DELETE',
        url: '/api/playlists/tracks',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer orbim-local-access-token-${ownerId}`,
        },
        body: { playlistId: testPlId },
      })
      const missingParamRes = createMockRes()
      await playlistTracksHandler(missingParamReq, missingParamRes.res)
      assert.equal(missingParamRes.getStatusCode(), 400)

      // Test B: DELETE without Authorization returns 401
      const unauthReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
      })
      const unauthRes = createMockRes()
      await playlistTracksHandler(unauthReq, unauthRes.res)
      assert.equal(unauthRes.getStatusCode(), 401)
      assert.match(unauthRes.getJson<{ error: string }>().error, /Authentication required/i)

      // Test C: DELETE with ?userId=<owner-id> but without Authorization returns 401
      const bypassQueryReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}&userId=${ownerId}`,
      })
      const bypassQueryRes = createMockRes()
      await playlistTracksHandler(bypassQueryReq, bypassQueryRes.res)
      assert.equal(bypassQueryRes.getStatusCode(), 401)

      // Test D: DELETE with a forged request-body userId returns 401
      const bypassBodyReq = createMockReq({
        method: 'DELETE',
        url: '/api/playlists/tracks',
        headers: { 'content-type': 'application/json' },
        body: { playlistId: testPlId, trackId: track1Owner, userId: ownerId },
      })
      const bypassBodyRes = createMockRes()
      await playlistTracksHandler(bypassBodyReq, bypassBodyRes.res)
      assert.equal(bypassBodyRes.getStatusCode(), 401)

      // Test E: Invalid or expired tokens return 401
      const invalidTokenReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
        headers: { authorization: 'Bearer invalid-or-expired-token-xyz' },
      })
      const invalidTokenRes = createMockRes()
      await playlistTracksHandler(invalidTokenReq, invalidTokenRes.res)
      assert.equal(invalidTokenRes.getStatusCode(), 401)
      assert.match(invalidTokenRes.getJson<{ error: string }>().error, /Invalid or expired/i)

      // Test F: Non-member attempting removal returns 403
      const unauthorizedReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
        headers: { authorization: `Bearer orbim-local-access-token-${intruderId}` },
      })
      const unauthorizedRes = createMockRes()
      await playlistTracksHandler(unauthorizedReq, unauthorizedRes.res)
      assert.equal(unauthorizedRes.getStatusCode(), 403)

      // --- Security Phase 2 Tests ---

      // Test G: Viewer attempting removal returns 403
      const viewerRemoveReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
        headers: { authorization: `Bearer orbim-local-access-token-${viewerId}` },
      })
      const viewerRemoveRes = createMockRes()
      await playlistTracksHandler(viewerRemoveReq, viewerRemoveRes.res)
      assert.equal(viewerRemoveRes.getStatusCode(), 403)
      assert.match(viewerRemoveRes.getJson<{ error: string }>().error, /viewers cannot remove tracks/i)

      // Test H: Editor attempting to remove another user's track (track1 added by owner) returns 403
      const editorRemoveOthersReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
        headers: { authorization: `Bearer orbim-local-access-token-${collabId}` },
      })
      const editorRemoveOthersRes = createMockRes()
      await playlistTracksHandler(editorRemoveOthersReq, editorRemoveOthersRes.res)
      assert.equal(editorRemoveOthersRes.getStatusCode(), 403)
      assert.match(editorRemoveOthersRes.getJson<{ error: string }>().error, /editors can only remove tracks they added/i)

      // Test I: Editor removing their own track (track2 added by collab) returns 200
      const editorRemoveOwnReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track2Collab}`,
        headers: { authorization: `Bearer orbim-local-access-token-${collabId}` },
      })
      const editorRemoveOwnRes = createMockRes()
      await playlistTracksHandler(editorRemoveOwnReq, editorRemoveOwnRes.res)
      assert.equal(editorRemoveOwnRes.getStatusCode(), 200)
      assert.equal(editorRemoveOwnRes.getJson<{ success: boolean; removed: boolean }>().removed, true)

      // Test J: Owner removing another user's track (add track again by collab, owner removes it)
      const track2ReAddReq = createMockReq({
        method: 'POST',
        url: '/api/playlists/tracks',
        headers: { 'content-type': 'application/json' },
        body: {
          track: {
            id: track2Collab,
            playlist_id: testPlId,
            provider: 'spotify',
            provider_track_id: 'test-del-track-2',
            title: 'Collab Track Re-Added',
            artist_name: 'Collab Artist',
            duration_seconds: 150,
            position: 2,
            added_by: collabId,
            created_at: new Date().toISOString(),
          },
        },
      })
      const track2ReAddRes = createMockRes()
      await playlistTracksHandler(track2ReAddReq, track2ReAddRes.res)
      assert.equal(track2ReAddRes.getStatusCode(), 200)

      const ownerRemoveOtherReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track2Collab}`,
        headers: { authorization: `Bearer orbim-local-access-token-${ownerId}` },
      })
      const ownerRemoveOtherRes = createMockRes()
      await playlistTracksHandler(ownerRemoveOtherReq, ownerRemoveOtherRes.res)
      assert.equal(ownerRemoveOtherRes.getStatusCode(), 200)
      assert.equal(ownerRemoveOtherRes.getJson<{ success: boolean; removed: boolean }>().removed, true)

      // Test K: Platform Administrator removing any track (admin removes track3)
      const adminRemoveReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track3Admin}`,
        headers: { authorization: `Bearer orbim-local-access-token-${adminId}` },
      })
      const adminRemoveRes = createMockRes()
      await playlistTracksHandler(adminRemoveReq, adminRemoveRes.res)
      assert.equal(adminRemoveRes.getStatusCode(), 200)
      assert.equal(adminRemoveRes.getJson<{ success: boolean; removed: boolean }>().removed, true)

      // Test L: Non-existent playlist (404)
      const notFoundReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=non-existent-pl&trackId=${track1Owner}`,
        headers: { authorization: `Bearer orbim-local-access-token-${ownerId}` },
      })
      const notFoundRes = createMockRes()
      await playlistTracksHandler(notFoundReq, notFoundRes.res)
      assert.equal(notFoundRes.getStatusCode(), 404)

      // Test M: Valid authenticated owner removes their own track (track1)
      const ownerRemoveOwnReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
        headers: { authorization: `Bearer orbim-local-access-token-${ownerId}` },
      })
      const ownerRemoveOwnRes = createMockRes()
      await playlistTracksHandler(ownerRemoveOwnReq, ownerRemoveOwnRes.res)
      assert.equal(ownerRemoveOwnRes.getStatusCode(), 200)
      assert.equal(ownerRemoveOwnRes.getJson<{ success: boolean; removed: boolean }>().removed, true)

      // Test N: Safe/idempotent handling when track is already removed (200, notFound: true)
      const idempotentReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists/tracks?playlistId=${testPlId}&trackId=${track1Owner}`,
        headers: { authorization: `Bearer orbim-local-access-token-${ownerId}` },
      })
      const idempotentRes = createMockRes()
      await playlistTracksHandler(idempotentReq, idempotentRes.res)
      assert.equal(idempotentRes.getStatusCode(), 200)
      assert.equal(idempotentRes.getJson<{ notFound: boolean }>().notFound, true)

      // Cleanup playlist
      const cleanReq = createMockReq({
        method: 'DELETE',
        url: `/api/playlists?playlistId=${encodeURIComponent(testPlId)}`,
        headers: { authorization: `Bearer orbim-local-access-token-${ownerId}` },
      })
      const cleanRes = createMockRes()
      await playlistsHandler(cleanReq, cleanRes.res)
      assert.equal(cleanRes.getStatusCode(), 200)
    })
  })

  describe('9. /api/audio/stream', () => {
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

  describe('10. Vercel Dynamic Route Dispatchers ([route].ts)', () => {
    it('audioDispatcher resolves stream from rewritten query route param', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/audio/[route]?route=stream&path=global/test-audio-uuid.mp3',
      })
      const res = createMockRes()

      await audioDispatcher(req, res.res)

      assert.equal(res.getStatusCode(), 307)
      const location = res.getHeaders()['Location']
      assert.ok(typeof location === 'string')
      assert.ok(location.includes('supabase.co/storage/v1/object/public/track-audio/global/test-audio-uuid.mp3'))
    })

    it('audioDispatcher falls back to pathname in local environment', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/audio/stream?path=global/test-audio-uuid.mp3',
      })
      const res = createMockRes()

      await audioDispatcher(req, res.res)

      assert.equal(res.getStatusCode(), 307)
    })

    it('spotifyDispatcher resolves health from rewritten query route param', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/spotify/[route]?route=health',
      })
      const res = createMockRes()

      await spotifyDispatcher(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ ok: boolean }>()
      assert.equal(data.ok, true)
    })

    it('invitationsDispatcher resolves preview from rewritten query route param', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/invitations/[route]?route=preview&token=invalid-short',
      })
      const res = createMockRes()

      await invitationsDispatcher(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ found: boolean }>()
      assert.equal(data.found, false)
    })

    it('playlistsDispatcher resolves tracks from rewritten query route param', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/playlists/[route]?route=tracks&playlistId=nonexistent',
      })
      const res = createMockRes()

      await playlistsDispatcher(req, res.res)

      assert.equal(res.getStatusCode(), 200)
      const data = res.getJson<{ tracks: unknown[] }>()
      assert.deepEqual(data.tracks, [])
    })

    it('returns 404 for unknown dynamic action in dispatcher', async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/audio/[route]?route=unknown-action',
      })
      const res = createMockRes()

      await audioDispatcher(req, res.res)

      assert.equal(res.getStatusCode(), 404)
    })
  })
})

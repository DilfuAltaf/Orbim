/**
 * Vite Dev Server & Preview Plugin for Spotify Server-Side API.
 *
 * Exposes:
 * - GET /api/spotify/search?q=...&limit=...
 * - GET /api/spotify/health
 *
 * Keeps CLIENT_SECRET_SPOTIFY strictly on the server side.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import {
  deleteServerAudioRecord,
  loadServerAudioRegistry,
  saveServerAudioRecord,
  type ServerAudioRecord,
} from './audio-registry-service.ts'
import {
  acceptServerInvitation,
  addPlaylistCollaborator,
  createServerInvitation,
  deleteServerNotification,
  deleteServerPlaylist,
  deleteServerPlaylistTrack,
  getFullServerPlaylist,
  getServerInvitationPreview,
  getUserServerPlaylists,
  listServerInvitationsForPlaylist,
  listServerInvitationsForUser,
  loadPlaylistCollaborators,
  loadServerNotifications,
  loadServerPlaylistTracks,
  loadServerUsers,
  removePlaylistCollaborator,
  respondToServerInvitation,
  saveServerNotification,
  saveServerPlaylist,
  saveServerPlaylistTrack,
  saveServerUser,
  updateNotificationStatus,
  type ServerNotificationRecord,
  type ServerPlaylistRecord,
  type ServerPlaylistTrackRecord,
  type ServerUserRecord,
} from './user-invitation-service.ts'
import {
  searchSpotifyTracksServer,
  getSpotifyServerCredentials,
  fetchSpotifyTrackLyricsServer,
} from './spotify-service.ts'

export function spotifyApiDevPlugin(): Plugin {
  function handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')

    if (parsedUrl.pathname === '/api/spotify/health') {
      const { clientId, clientSecret } = getSpotifyServerCredentials()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      })
      res.end(
        JSON.stringify({
          ok: true,
          configured: Boolean(clientId && clientSecret),
        }),
      )
      return true
    }

    if (parsedUrl.pathname === '/api/spotify/search') {
      const q = parsedUrl.searchParams.get('q') || ''
      const limitRaw = parsedUrl.searchParams.get('limit')
      const limit = limitRaw ? parseInt(limitRaw, 10) : 10
      const offsetRaw = parsedUrl.searchParams.get('offset')
      const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0

      if (!q.trim()) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        })
        res.end(JSON.stringify({ tracks: [] }))
        return true
      }

      searchSpotifyTracksServer(q, { limit, offset })
        .then((tracks) => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          })
          res.end(JSON.stringify({ tracks }))
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          const isRateLimit = message.toLowerCase().includes('rate limit')
          const statusCode = isRateLimit ? 429 : 500

          res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          })
          res.end(
            JSON.stringify({
              error: isRateLimit
                ? 'Spotify rate limit exceeded. Please wait a moment.'
                : 'Failed to search Spotify metadata on server.',
              detail: message,
            }),
          )
        })

      return true
    }

    if (parsedUrl.pathname === '/api/spotify/lyrics') {
      const qTitle = parsedUrl.searchParams.get('title') || ''
      const qArtist = parsedUrl.searchParams.get('artist') || ''

      if (!qTitle.trim() || !qArtist.trim()) {
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        })
        res.end(JSON.stringify({ error: 'Missing title or artist parameter' }))
        return true
      }

      fetchSpotifyTrackLyricsServer(qTitle, qArtist)
        .then((result) => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          })
          res.end(JSON.stringify(result))
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          res.writeHead(404, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          })
          res.end(JSON.stringify({ error: 'Lyrics not found', detail: message }))
        })

      return true
    }

    if (parsedUrl.pathname === '/api/audio/upload' && req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const contentType = req.headers['content-type'] || 'application/octet-stream'
          const providerTrackId = (req.headers['x-provider-track-id'] as string) || ''
          const rawFileName = (req.headers['x-file-name'] as string) || 'track.mp3'
          let fileName = decodeURIComponent(rawFileName)
          const title = decodeURIComponent((req.headers['x-title'] as string) || '')
          const artistName = decodeURIComponent((req.headers['x-artist'] as string) || '')

          let fileBuffer: Buffer

          if (contentType.includes('application/json')) {
            const bodyStr = Buffer.concat(chunks).toString('utf8')
            const json = JSON.parse(bodyStr) as {
              providerTrackId?: string
              fileName?: string
              title?: string
              artistName?: string
              base64Data?: string
            }
            if (!json.base64Data) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing base64Data' }))
              return
            }
            fileBuffer = Buffer.from(json.base64Data, 'base64')
            if (json.fileName) fileName = json.fileName
          } else {
            fileBuffer = Buffer.concat(chunks)
          }

          if (fileBuffer.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Empty file payload' }))
            return
          }

          const dotIdx = fileName.lastIndexOf('.')
          const ext = dotIdx !== -1 ? fileName.substring(dotIdx).toLowerCase() : '.mp3'
          const trackUuid = crypto.randomUUID()
          const relativeStoragePath = `global/${trackUuid}${ext}`

          const diskDir = path.resolve(process.cwd(), 'assets/audio/global')
          if (!fs.existsSync(diskDir)) {
            fs.mkdirSync(diskDir, { recursive: true })
          }
          const diskPath = path.resolve(diskDir, `${trackUuid}${ext}`)
          fs.writeFileSync(diskPath, fileBuffer)

          const audioUrl = `/assets/audio/global/${trackUuid}${ext}`

          if (providerTrackId) {
            saveServerAudioRecord({
              providerTrackId,
              audioUrl,
              audioSourceType: 'direct_stream',
              title,
              artistName,
              updatedAt: new Date().toISOString(),
            })
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          })
          res.end(
            JSON.stringify({
              success: true,
              audioUrl,
              storagePath: relativeStoragePath,
            }),
          )
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Server failed to process audio upload: ${msg}` }))
        }
      })
      return true
    }

    if (parsedUrl.pathname === '/api/audio/registry' || parsedUrl.pathname === '/api/spotify/audio-registry') {
      if (req.method === 'DELETE') {
        const queryTrackId = parsedUrl.searchParams.get('providerTrackId')
        if (queryTrackId) {
          deleteServerAudioRecord(queryTrackId)
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          })
          res.end(JSON.stringify({ success: true, deleted: true }))
          return true
        }

        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as { providerTrackId?: string }
            if (parsed.providerTrackId) {
              deleteServerAudioRecord(parsed.providerTrackId)
            }
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
            })
            res.end(JSON.stringify({ success: true, deleted: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
          }
        })
        return true
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as {
              action?: string
              delete?: boolean
              record?: ServerAudioRecord
              records?: Record<string, ServerAudioRecord>
              providerTrackId?: string
              audioUrl?: string
              storagePath?: string
              title?: string
              artistName?: string
            }
            if (parsed.delete || parsed.action === 'delete') {
              if (parsed.providerTrackId) {
                deleteServerAudioRecord(parsed.providerTrackId)
              }
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
              })
              res.end(JSON.stringify({ success: true, deleted: true }))
              return
            }
            if (parsed.record) {
              saveServerAudioRecord(parsed.record)
            } else if (parsed.records) {
              for (const r of Object.values(parsed.records)) {
                saveServerAudioRecord(r)
              }
            } else if (parsed.providerTrackId && parsed.audioUrl) {
              saveServerAudioRecord({
                providerTrackId: parsed.providerTrackId,
                audioUrl: parsed.audioUrl,
                audioSourceType: 'direct_stream',
                title: parsed.title,
                artistName: parsed.artistName,
                updatedAt: new Date().toISOString(),
              })
            }
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
            })
            res.end(JSON.stringify({ success: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
          }
        })
        return true
      }

      const records = loadServerAudioRegistry(true)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      })
      res.end(JSON.stringify({ success: true, records, ...records }))
      return true
    }

    if (parsedUrl.pathname === '/api/users') {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as { user?: ServerUserRecord }
            if (parsed.user) {
              saveServerUser(parsed.user)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }
      // Public directory: never expose account emails or internal metadata.
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase()
      const users = loadServerUsers()
        .filter((u) => !q || u.displayName.toLowerCase().includes(q))
        .map((u) => ({
          id: u.id,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl ?? null,
          location: u.location ?? null,
        }))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: true, users }))
      return true
    }

    if (parsedUrl.pathname === '/api/invitations') {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              playlistId?: string
              createdBy?: string
              inviteeId?: string | null
              inviteeDisplayName?: string | null
              rawToken?: string
              tokenHash?: string
              role?: string
              expiresAt?: string
              playlistTitle?: string
            }
            const result = createServerInvitation({
              playlistId: parsed.playlistId || '',
              createdBy: parsed.createdBy || '',
              inviteeId: parsed.inviteeId || null,
              inviteeDisplayName: parsed.inviteeDisplayName || null,
              rawToken: parsed.rawToken,
              tokenHash: parsed.tokenHash,
              role: parsed.role,
              expiresAt: parsed.expiresAt,
              playlistTitle: parsed.playlistTitle,
            })
            const statusCode = result.success
              ? 200
              : result.errorKind === 'unauthorized'
                ? 403
                : result.errorKind === 'already_member'
                  ? 409
                  : 400
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      // Owner playlist view, or the recipient inbox when no playlistId is given.
      const playlistId = parsedUrl.searchParams.get('playlistId')
      const userId = parsedUrl.searchParams.get('userId') || undefined
      if (playlistId) {
        const result = listServerInvitationsForPlaylist(playlistId, userId)
        res.writeHead(result.error ? 403 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
        res.end(JSON.stringify({ success: !result.error, ...result }))
        return true
      }

      const invitations = listServerInvitationsForUser({
        userId,
        email: parsedUrl.searchParams.get('email') || undefined,
        displayName: parsedUrl.searchParams.get('displayName') || undefined,
      })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: true, invitations }))
      return true
    }

    if (parsedUrl.pathname === '/api/invitations/preview') {
      const token = parsedUrl.searchParams.get('token') || ''
      const result = getServerInvitationPreview(token, parsedUrl.searchParams.get('userId') || undefined)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: result.found, ...result }))
      return true
    }

    if (parsedUrl.pathname === '/api/invitations/respond') {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as {
            invitationId?: string
            userId?: string
            displayName?: string
            action?: 'accept' | 'decline'
          }
          if (!parsed.invitationId || !parsed.action || (parsed.action !== 'accept' && parsed.action !== 'decline')) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, errorKind: 'invalid', error: 'Missing invitationId or action' }))
            return
          }
          const result = respondToServerInvitation({
            invitationId: parsed.invitationId,
            userId: parsed.userId || '',
            displayName: parsed.displayName,
            action: parsed.action,
          })
          const statusCode = result.success
            ? 200
            : result.errorKind === 'unauthorized'
              ? 403
              : result.errorKind === 'expired' || result.errorKind === 'revoked' || result.errorKind === 'declined'
                ? 410
                : 400
          res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, errorKind: 'invalid', error: 'Invalid JSON' }))
        }
      })
      return true
    }

    if (parsedUrl.pathname === '/api/invitations/accept') {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as {
            token: string
            userId: string
            displayName?: string
          }
          const result = acceptServerInvitation(parsed)
          const statusCode = result.success
            ? 200
            : result.errorKind === 'wrong_account'
              ? 403
              : result.errorKind === 'expired' ||
                  result.errorKind === 'revoked' ||
                  result.errorKind === 'declined' ||
                  result.errorKind === 'already_accepted'
                ? 410
                : 400
          res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return true
    }

    if (parsedUrl.pathname === '/api/playlists/collaborators') {
      if (req.method === 'DELETE') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              playlistId?: string
              userId?: string
            }
            const playlistId = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
            const userId = parsedUrl.searchParams.get('userId') || parsed.userId
            if (playlistId && userId) {
              removePlaylistCollaborator(playlistId, userId)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, removed: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              playlistId: string
              userId: string
              displayName: string
              location?: string
              role?: string
            }
            addPlaylistCollaborator(parsed)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }
      const playlistId = parsedUrl.searchParams.get('playlistId') || undefined
      const collaborators = loadPlaylistCollaborators(playlistId)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: true, collaborators }))
      return true
    }

    if (parsedUrl.pathname === '/api/notifications') {
      if (req.method === 'DELETE') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as { id?: string }
            const id = parsedUrl.searchParams.get('id') || parsed.id
            if (id) {
              deleteServerNotification(id)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, deleted: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      if (req.method === 'PATCH') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              id?: string
              status?: 'accepted' | 'rejected'
              userId?: string
              displayName?: string
            }
            if (!parsed.id || !parsed.status) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing id or status' }))
              return
            }
            const updated = updateNotificationStatus(
              parsed.id,
              parsed.status,
              parsed.userId,
              parsed.displayName,
            )
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, notification: updated }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as ServerNotificationRecord
            if (!parsed.id) {
              parsed.id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            }
            if (!parsed.createdAt) {
              parsed.createdAt = new Date().toISOString()
            }
            if (!parsed.status) {
              parsed.status = 'pending'
            }
            saveServerNotification(parsed)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, notification: parsed }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      const userId = parsedUrl.searchParams.get('userId') || undefined
      const email = parsedUrl.searchParams.get('email') || undefined
      const displayName = parsedUrl.searchParams.get('displayName') || undefined
      const notifications = loadServerNotifications({ userId, email, displayName })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: true, notifications }))
      return true
    }

    if (parsedUrl.pathname === '/api/playlists') {
      if (req.method === 'DELETE') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as { playlistId?: string }
            const pid = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
            if (pid) {
              deleteServerPlaylist(pid)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, deleted: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              playlist?: ServerPlaylistRecord
              tracks?: ServerPlaylistTrackRecord[]
              id?: string
              title?: string
              description?: string | null
              owner_id?: string
              visibility?: string
              created_at?: string
              updated_at?: string
            }
            const pl: ServerPlaylistRecord | null =
              parsed.playlist ||
              (parsed.id && parsed.title
                ? {
                    id: parsed.id,
                    title: parsed.title,
                    description: parsed.description ?? null,
                    owner_id: parsed.owner_id || 'system',
                    visibility: (parsed.visibility === 'shared' ? 'shared' : 'private') as
                      | 'private'
                      | 'shared',
                    created_at: parsed.created_at || new Date().toISOString(),
                    updated_at: parsed.updated_at || new Date().toISOString(),
                  }
                : null)

            if (pl) {
              saveServerPlaylist(pl)
              if (Array.isArray(parsed.tracks)) {
                for (const tr of parsed.tracks) {
                  saveServerPlaylistTrack(tr)
                }
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, playlist: pl }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      const playlistId = parsedUrl.searchParams.get('playlistId')
      if (playlistId) {
        const full = getFullServerPlaylist(playlistId)
        if (!full) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Playlist not found', data: null }))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
          res.end(JSON.stringify({ success: true, data: full }))
        }
        return true
      }

      const userId = parsedUrl.searchParams.get('userId') || undefined
      const email = parsedUrl.searchParams.get('email') || undefined
      const displayName = parsedUrl.searchParams.get('displayName') || undefined
      const playlists = getUserServerPlaylists({ userId, email, displayName })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: true, playlists }))
      return true
    }

    if (parsedUrl.pathname === '/api/playlists/tracks') {
      if (req.method === 'DELETE') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              playlistId?: string
              trackId?: string
            }
            const pid = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
            const tid = parsedUrl.searchParams.get('trackId') || parsed.trackId
            if (pid && tid) {
              deleteServerPlaylistTrack(pid, tid)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, deleted: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              track?: ServerPlaylistTrackRecord
              tracks?: ServerPlaylistTrackRecord[]
              id?: string
              playlist_id?: string
              [key: string]: unknown
            }
            if (parsed.track) {
              saveServerPlaylistTrack(parsed.track)
            } else if (Array.isArray(parsed.tracks)) {
              for (const tr of parsed.tracks) {
                saveServerPlaylistTrack(tr)
              }
            } else if (parsed.id && parsed.playlist_id) {
              saveServerPlaylistTrack(parsed as unknown as ServerPlaylistTrackRecord)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return true
      }

      const playlistId = parsedUrl.searchParams.get('playlistId') || undefined
      const tracks = loadServerPlaylistTracks(playlistId)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({ success: true, tracks }))
      return true
    }

    if (parsedUrl.pathname.startsWith('/assets/audio/')) {
      const decodedPath = decodeURIComponent(parsedUrl.pathname)
      const relativePath = decodedPath.replace(/^\//, '')
      const absolutePath = path.resolve(process.cwd(), relativePath)

      // Prevent directory traversal
      if (!absolutePath.startsWith(path.resolve(process.cwd(), 'assets/audio'))) {
        res.writeHead(403)
        res.end('Forbidden')
        return true
      }

      // If file does NOT exist on local disk, check if we can redirect to a remote CDN URL
      if (!fs.existsSync(absolutePath)) {
        const registry = loadServerAudioRegistry(false)
        for (const rec of Object.values(registry)) {
          if (rec.audioUrl && rec.audioUrl.startsWith('http') && rec.storagePath) {
            const recBase = path.basename(rec.storagePath)
            const reqBase = path.basename(decodedPath)
            if (recBase === reqBase) {
              res.writeHead(307, {
                Location: rec.audioUrl,
                'Cache-Control': 'public, max-age=3600',
              })
              res.end()
              return true
            }
          }
        }

        res.writeHead(404)
        res.end('Audio file not found')
        return true
      }

      const stat = fs.statSync(absolutePath)
      const range = req.headers.range

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
        const chunkSize = end - start + 1

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'audio/mpeg',
        })
        fs.createReadStream(absolutePath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'audio/mpeg',
        })
        fs.createReadStream(absolutePath).pipe(res)
      }
      return true
    }

    return false
  }

  return {
    name: 'orbim-spotify-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url?.startsWith('/api/spotify/') ||
          req.url?.startsWith('/api/audio/') ||
          req.url?.startsWith('/api/users') ||
          req.url?.startsWith('/api/invitations') ||
          req.url?.startsWith('/api/notifications') ||
          req.url?.startsWith('/api/playlists/') ||
          req.url?.startsWith('/assets/audio/')
        ) {
          if (handleRequest(req, res)) {
            return
          }
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url?.startsWith('/api/spotify/') ||
          req.url?.startsWith('/api/audio/') ||
          req.url?.startsWith('/api/users') ||
          req.url?.startsWith('/api/invitations') ||
          req.url?.startsWith('/api/notifications') ||
          req.url?.startsWith('/api/playlists/') ||
          req.url?.startsWith('/assets/audio/')
        ) {
          if (handleRequest(req, res)) {
            return
          }
        }
        next()
      })
    },
  }
}

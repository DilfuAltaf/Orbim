import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { loadServerAudioRegistry } from '../../src/server/audio-registry-service.ts'

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const requestedPath = parsedUrl.searchParams.get('path') || parsedUrl.pathname.replace(/^\/assets\/audio\//, '')
  const decodedPath = decodeURIComponent(requestedPath).replace(/^\//, '')
  const absolutePath = path.resolve(process.cwd(), 'assets/audio', decodedPath)

  // Prevent directory traversal
  const baseAudioDir = path.resolve(process.cwd(), 'assets/audio')
  if (!absolutePath.startsWith(baseAudioDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  // 1. Check registry for remote CDN URL
  const registry = loadServerAudioRegistry(false)
  const reqBase = path.basename(decodedPath)

  for (const rec of Object.values(registry)) {
    if (rec.audioUrl && rec.audioUrl.startsWith('http')) {
      const recBase = rec.storagePath ? path.basename(rec.storagePath) : path.basename(rec.audioUrl)
      if (recBase === reqBase) {
        res.writeHead(307, {
          Location: rec.audioUrl,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end()
        return
      }
    }
  }

  // Fallback to Supabase Storage direct URL for global tracks
  if (decodedPath.startsWith('global/')) {
    const remoteUrl = `https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/${decodedPath}`
    res.writeHead(307, {
      Location: remoteUrl,
      'Cache-Control': 'public, max-age=3600',
    })
    res.end()
    return
  }

  // 2. If file exists locally on disk
  if (!fs.existsSync(absolutePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Audio file not found' }))
    return
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
}
